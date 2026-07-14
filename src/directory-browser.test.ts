import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listDirectory,
  InvalidDirectoryPathError,
  DirectoryNotFoundError,
  DirectoryAccessDeniedError,
  NotADirectoryError,
} from "./directory-browser.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-browse-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function isRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

test("listDirectory defaults to the injected homedir when no path is given", async () => {
  await withTempDir(async (dir) => {
    const listing = await listDirectory(undefined, { homedir: () => dir });
    assert.equal(listing.path, dir);
  });
});

test("listDirectory lists only subdirectories, sorted case-insensitively, skipping dotfolders and files", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "Zebra"));
    await mkdir(join(dir, "apple"));
    await mkdir(join(dir, ".hidden"));
    await writeFile(join(dir, "readme.txt"), "not a dir");

    const listing = await listDirectory(dir, {});

    assert.deepEqual(
      listing.entries.map((e) => e.name),
      ["apple", "Zebra"],
    );
  });
});

test("listDirectory flags entries and the current path as a git repo via .git marker presence", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".git"));
    await mkdir(join(dir, "repo-child"));
    await mkdir(join(dir, "repo-child", ".git"));
    await mkdir(join(dir, "plain-child"));

    const listing = await listDirectory(dir, {});

    assert.equal(listing.isGitRepo, true);
    const byName = Object.fromEntries(listing.entries.map((e) => [e.name, e.isGitRepo]));
    assert.equal(byName["repo-child"], true);
    assert.equal(byName["plain-child"], false);
  });
});

test("listDirectory treats a .git file (worktree pointer) the same as a .git directory", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, ".git"), "gitdir: /elsewhere/.git/worktrees/x\n");

    const listing = await listDirectory(dir, {});

    assert.equal(listing.isGitRepo, true);
  });
});

test("listDirectory computes parentPath via dirname, and null at the filesystem root", async () => {
  await withTempDir(async (dir) => {
    const nested = join(dir, "child");
    await mkdir(nested);

    const listing = await listDirectory(nested, {});
    assert.equal(listing.parentPath, dir);

    const rootListing = await listDirectory("/", {});
    assert.equal(rootListing.parentPath, null);
  });
});

test("listDirectory truncates entries and reports truncated: true past maxEntries", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "a"));
    await mkdir(join(dir, "b"));
    await mkdir(join(dir, "c"));

    const listing = await listDirectory(dir, { maxEntries: 2 });

    assert.equal(listing.entries.length, 2);
    assert.equal(listing.truncated, true);
  });
});

test("listDirectory does not report truncated when entries are only skipped for not being directories", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "a"));
    await mkdir(join(dir, "b"));
    await mkdir(join(dir, "c"));
    await writeFile(join(dir, "target-file.txt"), "hi");
    await symlink(join(dir, "target-file.txt"), join(dir, "link-to-file"));
    await symlink(join(dir, "does-not-exist"), join(dir, "broken-link"));

    const listing = await listDirectory(dir, {});

    assert.deepEqual(
      listing.entries.map((e) => e.name),
      ["a", "b", "c"],
    );
    assert.equal(listing.truncated, false);
  });
});

test("listDirectory reports truncated: false when under the limit", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "a"));

    const listing = await listDirectory(dir, {});
    assert.equal(listing.truncated, false);
  });
});

test("listDirectory rejects a relative path", async () => {
  await assert.rejects(() => listDirectory("relative/path", {}), InvalidDirectoryPathError);
});

test("listDirectory throws DirectoryNotFoundError for a missing path", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(() => listDirectory(join(dir, "nope"), {}), DirectoryNotFoundError);
  });
});

test("listDirectory throws NotADirectoryError when the path is a file", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "file.txt");
    await writeFile(filePath, "hi");
    await assert.rejects(() => listDirectory(filePath, {}), NotADirectoryError);
  });
});

test(
  "listDirectory throws DirectoryAccessDeniedError when the directory isn't readable",
  { skip: isRoot() },
  async () => {
    await withTempDir(async (dir) => {
      const locked = join(dir, "locked");
      await mkdir(locked);
      await chmod(locked, 0o000);
      try {
        await assert.rejects(() => listDirectory(locked, {}), DirectoryAccessDeniedError);
      } finally {
        await chmod(locked, 0o700);
      }
    });
  },
);
