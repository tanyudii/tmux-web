import { test } from "node:test";
import assert from "node:assert/strict";
import { UpgradeError, parseLatestTag, resolveLatestTag, runUpgrade } from "./upgrade.ts";
import type { ExecFn } from "./upgrade.ts";

function recordingExec(
  handlers: Record<string, (args: string[]) => { stdout: string; stderr: string }>,
): { exec: ExecFn; calls: string[] } {
  const calls: string[] = [];
  const exec: ExecFn = async (file, args) => {
    calls.push(`${file} ${args.join(" ")}`);
    const handler = handlers[file];
    if (!handler) throw new Error(`no handler for ${file}`);
    return handler(args);
  };
  return { exec, calls };
}

const LS_REMOTE_OUTPUT = [
  "abc123\trefs/tags/v1.3.0",
  "def456\trefs/tags/v1.3.0^{}",
  "ghi789\trefs/tags/v1.2.0",
  "jkl012\trefs/tags/v1.2.0^{}",
].join("\n");

test("parseLatestTag returns the first tag name, ignoring peeled ^{} refs", () => {
  assert.equal(parseLatestTag(LS_REMOTE_OUTPUT), "v1.3.0");
});

test("parseLatestTag returns null when there are no tags", () => {
  assert.equal(parseLatestTag(""), null);
});

test("resolveLatestTag resolves the newest tag via git ls-remote --sort=-v:refname", async () => {
  const { exec, calls } = recordingExec({ git: () => ({ stdout: LS_REMOTE_OUTPUT, stderr: "" }) });
  const tag = await resolveLatestTag({ exec });
  assert.equal(tag, "v1.3.0");
  assert.deepEqual(calls, ["git ls-remote --sort=-v:refname --tags git@github.com:tanyudii/tmux-web"]);
});

test("resolveLatestTag throws UpgradeError when the repo has no tags", async () => {
  const { exec } = recordingExec({ git: () => ({ stdout: "", stderr: "" }) });
  await assert.rejects(() => resolveLatestTag({ exec }), UpgradeError);
});

test("runUpgrade installs the explicitly requested tag without calling git ls-remote", async () => {
  const { exec, calls } = recordingExec({
    npm: () => ({ stdout: "", stderr: "" }),
    systemctl: (args) => (args.includes("is-active") ? { stdout: "inactive", stderr: "" } : { stdout: "", stderr: "" }),
  });
  await runUpgrade(["--tag", "v1.0.0"], { exec });
  assert.deepEqual(calls, [
    "npm install -g github:tanyudii/tmux-web#v1.0.0",
    "systemctl --user is-active tmux-web",
  ]);
});

test("runUpgrade resolves the latest tag when --tag is omitted", async () => {
  const { exec, calls } = recordingExec({
    git: () => ({ stdout: LS_REMOTE_OUTPUT, stderr: "" }),
    npm: () => ({ stdout: "", stderr: "" }),
    systemctl: (args) => (args.includes("is-active") ? { stdout: "inactive", stderr: "" } : { stdout: "", stderr: "" }),
  });
  await runUpgrade([], { exec });
  assert.deepEqual(calls, [
    "git ls-remote --sort=-v:refname --tags git@github.com:tanyudii/tmux-web",
    "npm install -g github:tanyudii/tmux-web#v1.3.0",
    "systemctl --user is-active tmux-web",
  ]);
});

test("runUpgrade restarts the service when it was active before upgrading", async () => {
  const { exec, calls } = recordingExec({
    npm: () => ({ stdout: "", stderr: "" }),
    systemctl: (args) => (args.includes("is-active") ? { stdout: "active", stderr: "" } : { stdout: "", stderr: "" }),
  });
  await runUpgrade(["--tag", "v1.0.0"], { exec });
  assert.deepEqual(calls, [
    "npm install -g github:tanyudii/tmux-web#v1.0.0",
    "systemctl --user is-active tmux-web",
    "systemctl --user restart tmux-web",
  ]);
});

test("runUpgrade throws UpgradeError when --tag is passed without a value", async () => {
  const { exec } = recordingExec({});
  await assert.rejects(() => runUpgrade(["--tag"], { exec }), UpgradeError);
});

test("runUpgrade throws UpgradeError when npm install fails", async () => {
  const { exec } = recordingExec({
    npm: () => {
      throw new Error("network error");
    },
  });
  await assert.rejects(() => runUpgrade(["--tag", "v1.0.0"], { exec }), UpgradeError);
});
