import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseStatusPorcelain,
  getChangedFiles,
  getFileDiff,
  WorktreeNotFoundError,
  GitStatusError,
} from "./git-status.ts";

const execFileAsync = promisify(execFileCb);

// --- parseStatusPorcelain (pure) ---

test("parseStatusPorcelain returns an empty array for empty output", () => {
  assert.deepEqual(parseStatusPorcelain(""), []);
});

test("parseStatusPorcelain parses an unstaged modification", () => {
  assert.deepEqual(parseStatusPorcelain(" M file.txt\0"), [
    { path: "file.txt", status: "modified", staged: false, oldPath: undefined },
  ]);
});

test("parseStatusPorcelain parses a staged addition", () => {
  assert.deepEqual(parseStatusPorcelain("A  new.txt\0"), [
    { path: "new.txt", status: "added", staged: true, oldPath: undefined },
  ]);
});

test("parseStatusPorcelain parses a staged deletion", () => {
  assert.deepEqual(parseStatusPorcelain("D  gone.txt\0"), [
    { path: "gone.txt", status: "deleted", staged: true, oldPath: undefined },
  ]);
});

test("parseStatusPorcelain emits two entries for a file staged AND further modified (MM)", () => {
  assert.deepEqual(parseStatusPorcelain("MM both.txt\0"), [
    { path: "both.txt", status: "modified", staged: true, oldPath: undefined },
    { path: "both.txt", status: "modified", staged: false, oldPath: undefined },
  ]);
});

test("parseStatusPorcelain parses an untracked file", () => {
  assert.deepEqual(parseStatusPorcelain("?? new-file.txt\0"), [
    { path: "new-file.txt", status: "untracked", staged: false, oldPath: undefined },
  ]);
});

test("parseStatusPorcelain parses a staged rename, consuming the extra NUL-separated old-path field", () => {
  assert.deepEqual(parseStatusPorcelain("R  new-name.txt\0old-name.txt\0"), [
    { path: "new-name.txt", status: "renamed", staged: true, oldPath: "old-name.txt" },
  ]);
});

test("parseStatusPorcelain stays aligned for entries after a rename", () => {
  const output = "R  new-name.txt\0old-name.txt\0 M other.txt\0";
  assert.deepEqual(parseStatusPorcelain(output), [
    { path: "new-name.txt", status: "renamed", staged: true, oldPath: "old-name.txt" },
    { path: "other.txt", status: "modified", staged: false, oldPath: undefined },
  ]);
});

test("parseStatusPorcelain falls back to 'modified' for unmerged/conflict codes", () => {
  assert.deepEqual(parseStatusPorcelain("UU conflict.txt\0"), [
    { path: "conflict.txt", status: "modified", staged: true, oldPath: undefined },
    { path: "conflict.txt", status: "modified", staged: false, oldPath: undefined },
  ]);
});

test("parseStatusPorcelain handles paths containing spaces (unquoted under -z)", () => {
  assert.deepEqual(parseStatusPorcelain(" M file with spaces.txt\0"), [
    { path: "file with spaces.txt", status: "modified", staged: false, oldPath: undefined },
  ]);
});

// --- getChangedFiles / getFileDiff (fake exec) ---

const fakeDirStat = async () => ({ isDirectory: () => true });

test("getChangedFiles groups parsed entries into staged/unstaged/untracked", async () => {
  const fakeExec = async () => ({
    stdout: "A  staged.txt\0 M unstaged.txt\0?? untracked.txt\0",
  });
  const result = await getChangedFiles("/repo", fakeExec, fakeDirStat);
  assert.deepEqual(result, {
    staged: [{ path: "staged.txt", status: "added", staged: true, oldPath: undefined }],
    unstaged: [{ path: "unstaged.txt", status: "modified", staged: false, oldPath: undefined }],
    untracked: [{ path: "untracked.txt", status: "untracked", staged: false, oldPath: undefined }],
  });
});

test("getChangedFiles calls git status --porcelain=v1 -z scoped to the worktree", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "" };
  };
  await getChangedFiles("/repo", fakeExec, fakeDirStat);
  assert.deepEqual(calls, [{ file: "git", args: ["-C", "/repo", "status", "--porcelain=v1", "-z"] }]);
});

test("getFileDiff runs plain git diff for unstaged mode", async () => {
  const calls: string[][] = [];
  const fakeExec = async (_file: string, args: string[]) => {
    calls.push(args);
    return { stdout: "diff --git a/x b/x\n+hello\n" };
  };
  const result = await getFileDiff("/repo", "x.txt", "unstaged", fakeExec);
  assert.deepEqual(calls, [["-C", "/repo", "diff", "--", "x.txt"]]);
  assert.deepEqual(result, { diff: "diff --git a/x b/x\n+hello\n", isUntracked: false, isBinary: false });
});

test("getFileDiff runs git diff --cached for staged mode", async () => {
  const calls: string[][] = [];
  const fakeExec = async (_file: string, args: string[]) => {
    calls.push(args);
    return { stdout: "diff --git a/x b/x\n" };
  };
  await getFileDiff("/repo", "x.txt", "staged", fakeExec);
  assert.deepEqual(calls, [["-C", "/repo", "diff", "--cached", "--", "x.txt"]]);
});

test("getFileDiff detects a binary diff and omits the raw (garbled) output", async () => {
  const fakeExec = async () => ({ stdout: "Binary files a/x.png and b/x.png differ\n" });
  const result = await getFileDiff("/repo", "x.png", "unstaged", fakeExec);
  assert.deepEqual(result, { diff: "", isUntracked: false, isBinary: true });
});

// --- getFileDiff (untracked, real fs) ---

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "git-status-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("getFileDiff reads an untracked text file's raw content", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "new.txt"), "hello world\n");
    const result = await getFileDiff(dir, "new.txt", "untracked");
    assert.deepEqual(result, { diff: "hello world\n", isUntracked: true, isBinary: false });
  });
});

test("getFileDiff detects an untracked binary file via a NUL byte in its first bytes", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "new.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
    const result = await getFileDiff(dir, "new.bin", "untracked");
    assert.deepEqual(result, { diff: "", isUntracked: true, isBinary: true });
  });
});

test("getFileDiff rejects a path that escapes the worktree", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(() => getFileDiff(dir, "../../../etc/passwd", "untracked"), GitStatusError);
  });
});

test("getChangedFiles throws WorktreeNotFoundError when the worktree directory doesn't exist", async () => {
  await assert.rejects(
    () => getChangedFiles("/tmp/does-not-exist-xyz-123"),
    WorktreeNotFoundError,
  );
});

// --- Real git integration ---

function isGitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test(
  "real git integration: staged, unstaged, untracked, and binary files are all reported correctly",
  { skip: !isGitAvailable() },
  async () => {
    await withTempDir(async (dir) => {
      await execFileAsync("git", ["init", "--quiet", dir]);
      await execFileAsync("git", ["-C", dir, "config", "user.email", "test@example.com"]);
      await execFileAsync("git", ["-C", dir, "config", "user.name", "Test"]);
      await writeFile(join(dir, "tracked.txt"), "original\n");
      await execFileAsync("git", ["-C", dir, "add", "tracked.txt"]);
      await execFileAsync("git", ["-C", dir, "commit", "--quiet", "-m", "initial"]);

      // unstaged modification
      await writeFile(join(dir, "tracked.txt"), "changed\n");
      // staged addition
      await writeFile(join(dir, "staged-new.txt"), "brand new\n");
      await execFileAsync("git", ["-C", dir, "add", "staged-new.txt"]);
      // untracked file
      await writeFile(join(dir, "untracked.txt"), "not added\n");
      // untracked binary file
      await writeFile(join(dir, "image.bin"), Buffer.from([0x00, 0xde, 0xad, 0xbe, 0xef]));

      const changes = await getChangedFiles(dir);
      assert.deepEqual(changes.staged, [{ path: "staged-new.txt", status: "added", staged: true, oldPath: undefined }]);
      assert.deepEqual(changes.unstaged, [{ path: "tracked.txt", status: "modified", staged: false, oldPath: undefined }]);
      assert.deepEqual(
        changes.untracked.map((f) => f.path).sort(),
        ["image.bin", "untracked.txt"],
      );

      const unstagedDiff = await getFileDiff(dir, "tracked.txt", "unstaged");
      assert.match(unstagedDiff.diff, /-original/);
      assert.match(unstagedDiff.diff, /\+changed/);

      const stagedDiff = await getFileDiff(dir, "staged-new.txt", "staged");
      assert.match(stagedDiff.diff, /\+brand new/);

      const untrackedDiff = await getFileDiff(dir, "untracked.txt", "untracked");
      assert.equal(untrackedDiff.diff, "not added\n");
      assert.equal(untrackedDiff.isBinary, false);

      const binaryDiff = await getFileDiff(dir, "image.bin", "untracked");
      assert.equal(binaryDiff.isBinary, true);
    });
  },
);
