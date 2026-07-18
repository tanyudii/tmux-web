import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHookScript, type HookScriptDeps, type HookPostedEvent } from "./hook-script.ts";

const execFileAsync = promisify(execFileCb);
const SECRET = "test-secret";
const CONFIG_DIR = "/fake/config/dir";

function baseDeps(overrides: Partial<HookScriptDeps> = {}): HookScriptDeps {
  return {
    captureLine: async () => "pane contents here",
    postHookEvent: async () => {},
    readStdin: async () => JSON.stringify({ hook_event_name: "Stop" }),
    loadSecret: async () => SECRET,
    ...overrides,
  };
}

test("runHookScript calls postHookEvent with Stop, the captured text, and the loaded secret when stdin says hook_event_name Stop", async () => {
  const posted: HookPostedEvent[] = [];
  const secretsSeen: string[] = [];
  const configDirsSeen: string[] = [];
  const deps = baseDeps({
    postHookEvent: async (_url, event, secret) => {
      posted.push(event);
      secretsSeen.push(secret);
    },
    loadSecret: async (configDir) => {
      configDirsSeen.push(configDir);
      return SECRET;
    },
  });

  await runHookScript({ session: "proj__feature", listenerUrl: "http://127.0.0.1:1", configDir: CONFIG_DIR }, deps);

  assert.deepEqual(posted, [{ session: "proj__feature", hookEvent: "Stop", text: "pane contents here" }]);
  assert.deepEqual(secretsSeen, [SECRET]);
  assert.deepEqual(configDirsSeen, [CONFIG_DIR]);
});

test("runHookScript reports Notification when stdin says so", async () => {
  const posted: HookPostedEvent[] = [];
  const deps = baseDeps({
    captureLine: async () => "asking a question?",
    postHookEvent: async (_url, event) => {
      posted.push(event);
    },
    readStdin: async () => JSON.stringify({ hook_event_name: "Notification" }),
  });

  await runHookScript({ session: "proj__feature", listenerUrl: "http://127.0.0.1:1", configDir: CONFIG_DIR }, deps);

  assert.equal(posted[0]?.hookEvent, "Notification");
});

test("runHookScript falls back to Stop and still posts when stdin is unparseable", async () => {
  const posted: HookPostedEvent[] = [];
  const deps = baseDeps({
    postHookEvent: async (_url, event) => {
      posted.push(event);
    },
    readStdin: async () => "not json",
  });

  await runHookScript({ session: "s", listenerUrl: "http://127.0.0.1:1", configDir: CONFIG_DIR }, deps);

  assert.equal(posted[0]?.hookEvent, "Stop");
});

test("runHookScript still posts (with empty text) when captureLine throws -- e.g. the session is already gone", async () => {
  const posted: HookPostedEvent[] = [];
  const deps = baseDeps({
    captureLine: async () => {
      throw new Error("can't find session");
    },
    postHookEvent: async (_url, event) => {
      posted.push(event);
    },
  });

  await runHookScript({ session: "s", listenerUrl: "http://127.0.0.1:1", configDir: CONFIG_DIR }, deps);

  assert.deepEqual(posted, [{ session: "s", hookEvent: "Stop", text: "" }]);
});

test("runHookScript resolves (never throws) even when postHookEvent itself fails -- Stop hooks must never make Claude Code block", async () => {
  const deps = baseDeps({
    postHookEvent: async () => {
      throw new Error("listener unreachable");
    },
  });

  await runHookScript({ session: "s", listenerUrl: "http://127.0.0.1:1", configDir: CONFIG_DIR }, deps);
});

test("runHookScript resolves (never throws) even when loadSecret itself fails", async () => {
  const deps = baseDeps({
    loadSecret: async () => {
      throw new Error("can't read secret file");
    },
  });

  await runHookScript({ session: "s", listenerUrl: "http://127.0.0.1:1", configDir: CONFIG_DIR }, deps);
});

function isTmuxAvailable(): boolean {
  try {
    execFileSync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
}

// Real end-to-end coverage: a real tmux pane with known visible text, a real
// `tmux capture-pane` invocation, a real secret loaded from a real 0600 file
// on disk (via the real hook-secret.ts, not a mock), and a real HTTP POST
// (with a real Authorization header) to a real local server -- the same
// "mocks would happily pass either way" risk CLAUDE.md flags for this
// repo's git/npm real-process tests applies here too, since the entire
// point of this script is gluing several real external systems (tmux,
// Claude Code's hook mechanism, the filesystem, HTTP) together correctly.
test(
  "real tmux + real secret file + real HTTP: runHookScript with default deps captures the pane and POSTs it, with the secret header, to a real listener",
  { skip: !isTmuxAvailable() },
  async () => {
    const sessionName = `tmux-web-mcp-hook-test-${process.pid}`;
    const configDir = await mkdtemp(join(tmpdir(), "tmux-web-mcp-hook-script-"));
    await execFileAsync("tmux", ["new-session", "-d", "-s", sessionName]);
    try {
      await execFileAsync("tmux", ["send-keys", "-t", sessionName, "echo hello-from-real-pane", "Enter"]);
      // Give the shell a moment to actually print before capturing.
      await new Promise((resolve) => setTimeout(resolve, 300));

      const { loadOrCreateHookSecret } = await import("./hook-secret.ts");
      const realSecret = await loadOrCreateHookSecret(configDir);

      const received: unknown[] = [];
      const receivedAuthHeaders: Array<string | undefined> = [];
      const server = createServer((req, res) => {
        receivedAuthHeaders.push(req.headers.authorization);
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          received.push(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
          res.writeHead(204);
          res.end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      const { runHookScript: run } = await import("./hook-script.ts");
      const { execFile } = await import("node:child_process");
      const execFileAsync2 = promisify(execFile);

      await run(
        { session: sessionName, listenerUrl: `http://127.0.0.1:${port}`, configDir },
        {
          captureLine: async (session) => {
            const { stdout } = await execFileAsync2("tmux", ["capture-pane", "-p", "-t", session]);
            return stdout;
          },
          postHookEvent: async (listenerUrl, event, secret) => {
            await fetch(`${listenerUrl}/hook`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
              body: JSON.stringify(event),
            });
          },
          readStdin: async () => JSON.stringify({ hook_event_name: "Stop" }),
          loadSecret: loadOrCreateHookSecret,
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 100));
      await new Promise<void>((resolve) => server.close(() => resolve()));

      assert.equal(received.length, 1);
      const event = received[0] as { session: string; hookEvent: string; text: string };
      assert.equal(event.session, sessionName);
      assert.equal(event.hookEvent, "Stop");
      assert.ok(event.text.includes("hello-from-real-pane"), `expected captured pane text to include the echoed line, got: ${event.text}`);
      assert.deepEqual(receivedAuthHeaders, [`Bearer ${realSecret}`]);
    } finally {
      await execFileAsync("tmux", ["kill-session", "-t", sessionName]).catch(() => {});
      await rm(configDir, { recursive: true, force: true });
    }
  },
);
