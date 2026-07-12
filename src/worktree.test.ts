import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveWorktreePath,
  isGitRepo,
  addWorktree,
  removeWorktree,
  WorktreeError,
  WorktreeConflictError,
  DirtyWorktreeError,
} from "./worktree.ts";

const execFileAsync = promisify(execFileCb);

test("resolveWorktreePath joins worktreesRoot/projectId/branchName", () => {
  assert.equal(
    resolveWorktreePath("proj1", "feature-x", "/data/worktrees"),
    "/data/worktrees/proj1/feature-x",
  );
});

test("resolveWorktreePath rejects a branch name that escapes the project root", () => {
  assert.throws(() => resolveWorktreePath("proj1", "../../etc/passwd", "/data/worktrees"), WorktreeError);
});

test("resolveWorktreePath rejects a project id that escapes the worktrees root", () => {
  assert.throws(() => resolveWorktreePath("../../etc", "feature-x", "/data/worktrees"), WorktreeError);
});

test("isGitRepo returns true when the exec check succeeds", async () => {
  const result = await isGitRepo("/some/repo", async () => ({ stdout: "true\n" }));
  assert.equal(result, true);
});

test("isGitRepo returns false when the exec check fails", async () => {
  const result = await isGitRepo("/not/a/repo", async () => {
    throw new Error("not a git repository");
  });
  assert.equal(result, false);
});

test("addWorktree prunes stale worktrees before adding a new one", async () => {
  const calls: string[][] = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push(args);
    return { stdout: "" };
  };

  await addWorktree("/repo", "/repo-worktrees/proj1/feature-x", "feature-x", fakeExec);

  assert.deepEqual(calls[0], ["-C", "/repo", "worktree", "prune"]);
  assert.deepEqual(calls[1], [
    "-C", "/repo",
    "worktree", "add", "--no-track", "-b", "feature-x",
    "/repo-worktrees/proj1/feature-x", "HEAD",
  ]);
});

test("addWorktree throws WorktreeConflictError when the branch already exists", async () => {
  const fakeExec = async (_file: string, args: string[]) => {
    if (args.includes("add")) {
      const err = new Error("Command failed") as Error & { stderr?: string };
      err.stderr = "fatal: a branch named 'feature-x' already exists\n";
      throw err;
    }
    return { stdout: "" };
  };

  await assert.rejects(
    () => addWorktree("/repo", "/repo-worktrees/proj1/feature-x", "feature-x", fakeExec),
    WorktreeConflictError,
  );
});

test("removeWorktree throws DirtyWorktreeError without --force when the worktree has uncommitted changes", async () => {
  const calls: string[][] = [];
  const fakeExec = async (_file: string, args: string[]) => {
    calls.push(args);
    const err = new Error("Command failed") as Error & { stderr?: string };
    err.stderr = "fatal: '/repo-worktrees/proj1/feature-x' contains modified or untracked files, use --force to delete it\n";
    throw err;
  };

  await assert.rejects(
    () => removeWorktree("/repo", "/repo-worktrees/proj1/feature-x", {}, fakeExec),
    DirtyWorktreeError,
  );
  assert.deepEqual(calls[0], ["-C", "/repo", "worktree", "remove", "/repo-worktrees/proj1/feature-x"]);
});

test("removeWorktree passes --force when requested", async () => {
  const calls: string[][] = [];
  const fakeExec = async (_file: string, args: string[]) => {
    calls.push(args);
    return { stdout: "" };
  };

  await removeWorktree("/repo", "/repo-worktrees/proj1/feature-x", { force: true }, fakeExec);

  assert.deepEqual(calls[0], ["-C", "/repo", "worktree", "remove", "--force", "/repo-worktrees/proj1/feature-x"]);
});

function isGitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test(
  "real git integration: add creates a working worktree, remove is blocked when dirty and succeeds with force",
  { skip: !isGitAvailable() },
  async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "worktree-test-repo-"));
    const worktreesRoot = await mkdtemp(join(tmpdir(), "worktree-test-root-"));
    try {
      await execFileAsync("git", ["init", "--quiet", repoPath]);
      await execFileAsync("git", ["-C", repoPath, "config", "user.email", "test@example.com"]);
      await execFileAsync("git", ["-C", repoPath, "config", "user.name", "Test"]);
      await writeFile(join(repoPath, "README.md"), "hello\n");
      await execFileAsync("git", ["-C", repoPath, "add", "README.md"]);
      await execFileAsync("git", ["-C", repoPath, "commit", "--quiet", "-m", "initial commit"]);

      const worktreePath = resolveWorktreePath("proj1", "feature-x", worktreesRoot);
      await addWorktree(repoPath, worktreePath, "feature-x");

      const content = await readFile(join(worktreePath, "README.md"), "utf-8");
      assert.equal(content, "hello\n");

      const { stdout: listOutput } = await execFileAsync("git", ["-C", repoPath, "worktree", "list"]);
      assert.match(listOutput, /feature-x/);

      await writeFile(join(worktreePath, "README.md"), "dirty change\n");
      await assert.rejects(() => removeWorktree(repoPath, worktreePath, {}), DirtyWorktreeError);

      await removeWorktree(repoPath, worktreePath, { force: true });
      await assert.rejects(() => stat(worktreePath));
    } finally {
      await rm(repoPath, { recursive: true, force: true });
      await rm(worktreesRoot, { recursive: true, force: true });
    }
  },
);
