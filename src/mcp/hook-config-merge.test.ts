import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSessionHooks, settingsLocalPath } from "./hook-config-merge.ts";

async function withTempWorktree(fn: (worktreePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-mcp-hooks-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("ensureSessionHooks creates settings.local.json with Stop and Notification hooks when none exists", async () => {
  await withTempWorktree(async (worktreePath) => {
    await ensureSessionHooks(worktreePath, "curl -fsS -m 3 http://127.0.0.1:5310/hook -d x");

    const raw = await readFile(settingsLocalPath(worktreePath), "utf-8");
    const parsed = JSON.parse(raw);

    assert.equal(parsed.hooks.Stop[0].hooks[0].command, "curl -fsS -m 3 http://127.0.0.1:5310/hook -d x");
    assert.equal(parsed.hooks.Stop[0].hooks[0].async, true);
    assert.equal(parsed.hooks.Notification[0].matcher, "*");
    assert.equal(parsed.hooks.Notification[0].hooks[0].command, "curl -fsS -m 3 http://127.0.0.1:5310/hook -d x");
  });
});

test("ensureSessionHooks preserves an existing unrelated hook entry instead of overwriting it", async () => {
  await withTempWorktree(async (worktreePath) => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(worktreePath, ".claude"), { recursive: true });
    await writeFile(
      settingsLocalPath(worktreePath),
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "echo already-here" }] }],
        },
        somethingElseTheUserSet: true,
      }),
    );

    await ensureSessionHooks(worktreePath, "curl -fsS -m 3 http://127.0.0.1:5310/hook -d x");

    const parsed = JSON.parse(await readFile(settingsLocalPath(worktreePath), "utf-8"));
    assert.equal(parsed.somethingElseTheUserSet, true);
    const stopCommands = parsed.hooks.Stop.flatMap((entry: { hooks: { command: string }[] }) =>
      entry.hooks.map((h) => h.command),
    );
    assert.ok(stopCommands.includes("echo already-here"));
    assert.ok(stopCommands.includes("curl -fsS -m 3 http://127.0.0.1:5310/hook -d x"));
  });
});

test("ensureSessionHooks is idempotent -- calling it twice does not duplicate the command", async () => {
  await withTempWorktree(async (worktreePath) => {
    await ensureSessionHooks(worktreePath, "curl -fsS -m 3 http://127.0.0.1:5310/hook -d x");
    await ensureSessionHooks(worktreePath, "curl -fsS -m 3 http://127.0.0.1:5310/hook -d x");

    const parsed = JSON.parse(await readFile(settingsLocalPath(worktreePath), "utf-8"));
    const stopCommands = parsed.hooks.Stop.flatMap((entry: { hooks: { command: string }[] }) =>
      entry.hooks.map((h) => h.command),
    );
    assert.equal(stopCommands.filter((c: string) => c.includes("127.0.0.1:5310")).length, 1);
  });
});

test("ensureSessionHooks leaves no leftover temp file after a successful write", async () => {
  await withTempWorktree(async (worktreePath) => {
    await ensureSessionHooks(worktreePath, "curl -fsS -m 3 http://127.0.0.1:5310/hook -d x");
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(join(worktreePath, ".claude"));
    assert.deepEqual(entries, ["settings.local.json"]);
  });
});

test("ensureSessionHooks writes settings.local.json with owner-only permissions", async () => {
  await withTempWorktree(async (worktreePath) => {
    await ensureSessionHooks(worktreePath, "curl -fsS -m 3 http://127.0.0.1:5310/hook -d x");
    const { stat } = await import("node:fs/promises");
    const stats = await stat(settingsLocalPath(worktreePath));
    assert.equal(stats.mode & 0o777, 0o600);
  });
});
