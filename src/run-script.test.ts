import { test } from "node:test";
import assert from "node:assert/strict";
import { runScript, ScriptError } from "./run-script.ts";

test("runScript executes the script through sh with the given cwd", async () => {
  const calls: { file: string; args: string[]; options: { cwd: string } }[] = [];
  const fakeExec = async (file: string, args: string[], options: { cwd: string }) => {
    calls.push({ file, args, options });
    return { stdout: "pre-run output\n", stderr: "" };
  };

  const result = await runScript("/repo/worktree/.tmux-web-env/pre-run.sh", "/repo/worktree", fakeExec);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "/bin/sh");
  assert.deepEqual(calls[0].args, ["/repo/worktree/.tmux-web-env/pre-run.sh"]);
  assert.deepEqual(calls[0].options, { cwd: "/repo/worktree" });
  assert.equal(result.stdout, "pre-run output\n");
});

test("runScript wraps a failing script in ScriptError with the stderr message", async () => {
  const fakeExec = async () => {
    throw Object.assign(new Error("exit code 1"), { stderr: "migration failed: relation not found\n" });
  };

  await assert.rejects(
    () => runScript("/repo/worktree/.tmux-web-env/post-run.sh", "/repo/worktree", fakeExec),
    (error: unknown) => {
      assert.ok(error instanceof ScriptError);
      assert.match((error as Error).message, /migration failed/);
      return true;
    },
  );
});

test("runScript falls back to the error message when stderr is empty", async () => {
  const fakeExec = async () => {
    throw new Error("spawn ENOENT");
  };

  await assert.rejects(
    () => runScript("/repo/worktree/.tmux-web-env/pre-run.sh", "/repo/worktree", fakeExec),
    (error: unknown) => {
      assert.ok(error instanceof ScriptError);
      assert.match((error as Error).message, /spawn ENOENT/);
      return true;
    },
  );
});
