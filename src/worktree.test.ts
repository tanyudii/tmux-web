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
  resolveOriginDefaultBranch,
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

test("resolveOriginDefaultBranch parses the branch name from `git ls-remote --symref origin HEAD`", async () => {
  const fakeExec = async (_file: string, args: string[]) => {
    assert.deepEqual(args, ["-C", "/repo", "ls-remote", "--symref", "origin", "HEAD"]);
    return { stdout: "ref: refs/heads/main\tHEAD\nabc123\tHEAD\n" };
  };

  const branch = await resolveOriginDefaultBranch("/repo", fakeExec);
  assert.equal(branch, "main");
});

test("resolveOriginDefaultBranch is not hardcoded to 'main' -- parses other default branch names", async () => {
  const fakeExec = async () => ({ stdout: "ref: refs/heads/trunk\tHEAD\n" });

  const branch = await resolveOriginDefaultBranch("/repo", fakeExec);
  assert.equal(branch, "trunk");
});

test("resolveOriginDefaultBranch throws WorktreeError when the symref line is missing from output", async () => {
  const fakeExec = async () => ({ stdout: "abc123\tHEAD\n" });

  await assert.rejects(() => resolveOriginDefaultBranch("/repo", fakeExec), WorktreeError);
});

test("resolveOriginDefaultBranch throws WorktreeError when ls-remote against origin fails", async () => {
  const fakeExec = async () => {
    throw new Error("fatal: 'origin' does not appear to be a git repository");
  };

  await assert.rejects(() => resolveOriginDefaultBranch("/repo", fakeExec), WorktreeError);
});

test("addWorktree prunes, resolves origin's default branch, fetches it, then adds a worktree based on origin/<branch>", async () => {
  const calls: string[][] = [];
  const fakeExec = async (_file: string, args: string[]) => {
    calls.push(args);
    if (args.includes("ls-remote")) {
      return { stdout: "ref: refs/heads/main\tHEAD\nabc123\tHEAD\n" };
    }
    return { stdout: "" };
  };

  await addWorktree("/repo", "/repo-worktrees/proj1/feature-x", "feature-x", fakeExec);

  assert.deepEqual(calls[0], ["-C", "/repo", "worktree", "prune"]);
  assert.deepEqual(calls[1], ["-C", "/repo", "ls-remote", "--symref", "origin", "HEAD"]);
  assert.deepEqual(calls[2], ["-C", "/repo", "fetch", "origin", "main:refs/remotes/origin/main"]);
  assert.deepEqual(calls[3], [
    "-C", "/repo",
    "worktree", "add", "--no-track", "-b", "feature-x",
    "/repo-worktrees/proj1/feature-x", "origin/main",
  ]);
});

test("addWorktree throws WorktreeError when it cannot resolve origin's default branch", async () => {
  const fakeExec = async (_file: string, args: string[]) => {
    if (args.includes("ls-remote")) {
      throw new Error("fatal: 'origin' does not appear to be a git repository");
    }
    return { stdout: "" };
  };

  await assert.rejects(
    () => addWorktree("/repo", "/repo-worktrees/proj1/feature-x", "feature-x", fakeExec),
    WorktreeError,
  );
});

test("addWorktree throws WorktreeError when fetching origin's default branch fails", async () => {
  const fakeExec = async (_file: string, args: string[]) => {
    if (args.includes("ls-remote")) return { stdout: "ref: refs/heads/main\tHEAD\n" };
    if (args.includes("fetch")) throw new Error("fatal: unable to access 'origin'");
    return { stdout: "" };
  };

  await assert.rejects(
    () => addWorktree("/repo", "/repo-worktrees/proj1/feature-x", "feature-x", fakeExec),
    WorktreeError,
  );
});

test("addWorktree throws WorktreeError for a worktree-add failure that isn't a branch conflict", async () => {
  const fakeExec = async (_file: string, args: string[]) => {
    if (args.includes("ls-remote")) return { stdout: "ref: refs/heads/main\tHEAD\n" };
    if (args.includes("add")) {
      const err = new Error("Command failed") as Error & { stderr?: string };
      err.stderr = "fatal: no space left on device\n";
      throw err;
    }
    return { stdout: "" };
  };

  await assert.rejects(
    () => addWorktree("/repo", "/repo-worktrees/proj1/feature-x", "feature-x", fakeExec),
    (error: unknown) => error instanceof WorktreeError && !(error instanceof WorktreeConflictError),
  );
});

test("addWorktree throws WorktreeConflictError when the branch already exists", async () => {
  const fakeExec = async (_file: string, args: string[]) => {
    if (args.includes("ls-remote")) return { stdout: "ref: refs/heads/main\tHEAD\n" };
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
  "real git integration: add creates a worktree from origin's default branch (not local HEAD), remove is blocked when dirty and succeeds with force",
  { skip: !isGitAvailable() },
  async () => {
    const originPath = await mkdtemp(join(tmpdir(), "worktree-test-origin-"));
    const repoPath = await mkdtemp(join(tmpdir(), "worktree-test-repo-"));
    const worktreesRoot = await mkdtemp(join(tmpdir(), "worktree-test-root-"));
    try {
      // "origin" uses a default branch name other than "main" to prove
      // resolveOriginDefaultBranch isn't hardcoded to "main".
      await execFileAsync("git", ["init", "--quiet", "--initial-branch=trunk", originPath]);
      await execFileAsync("git", ["-C", originPath, "config", "user.email", "test@example.com"]);
      await execFileAsync("git", ["-C", originPath, "config", "user.name", "Test"]);
      await writeFile(join(originPath, "README.md"), "from origin\n");
      await execFileAsync("git", ["-C", originPath, "add", "README.md"]);
      await execFileAsync("git", ["-C", originPath, "commit", "--quiet", "-m", "origin commit"]);

      await rm(repoPath, { recursive: true, force: true });
      await execFileAsync("git", ["clone", "--quiet", "--branch", "trunk", originPath, repoPath]);
      await execFileAsync("git", ["-C", repoPath, "config", "user.email", "test@example.com"]);
      await execFileAsync("git", ["-C", repoPath, "config", "user.name", "Test"]);

      // Diverge the local clone from origin/trunk with a commit that was
      // never pushed -- the new worktree must NOT see this content.
      await writeFile(join(repoPath, "README.md"), "local-only change\n");
      await execFileAsync("git", ["-C", repoPath, "add", "README.md"]);
      await execFileAsync("git", ["-C", repoPath, "commit", "--quiet", "-m", "local-only commit"]);

      const worktreePath = resolveWorktreePath("proj1", "feature-x", worktreesRoot);
      await addWorktree(repoPath, worktreePath, "feature-x");

      const content = await readFile(join(worktreePath, "README.md"), "utf-8");
      assert.equal(content, "from origin\n");

      const { stdout: listOutput } = await execFileAsync("git", ["-C", repoPath, "worktree", "list"]);
      assert.match(listOutput, /feature-x/);

      await writeFile(join(worktreePath, "README.md"), "dirty change\n");
      await assert.rejects(() => removeWorktree(repoPath, worktreePath, {}), DirtyWorktreeError);

      await removeWorktree(repoPath, worktreePath, { force: true });
      await assert.rejects(() => stat(worktreePath));
    } finally {
      await rm(originPath, { recursive: true, force: true });
      await rm(repoPath, { recursive: true, force: true });
      await rm(worktreesRoot, { recursive: true, force: true });
    }
  },
);
