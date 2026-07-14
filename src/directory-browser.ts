import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { homedir as osHomedir } from "node:os";

export interface DirectoryEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

export interface DirectoryListing {
  path: string;
  parentPath: string | null;
  isGitRepo: boolean;
  entries: DirectoryEntry[];
  truncated: boolean;
}

export class DirectoryBrowseError extends Error {}
export class InvalidDirectoryPathError extends DirectoryBrowseError {}
export class DirectoryNotFoundError extends DirectoryBrowseError {}
export class DirectoryAccessDeniedError extends DirectoryBrowseError {}
export class NotADirectoryError extends DirectoryBrowseError {}

export interface ListDirectoryDeps {
  homedir?: () => string;
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 2000;

// A cheap existence check, not `git rev-parse` -- this is a UI hint only.
// The authoritative check remains registerProject's isGitRepo (worktree.ts),
// which actually shells out to git at registration time.
async function hasGitMarker(candidatePath: string): Promise<boolean> {
  try {
    await stat(join(candidatePath, ".git"));
    return true;
  } catch {
    return false;
  }
}

export async function listDirectory(
  requestedPath: string | undefined,
  deps: ListDirectoryDeps = {},
): Promise<DirectoryListing> {
  const homedir = deps.homedir ?? osHomedir;
  const maxEntries = deps.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const targetPath = requestedPath && requestedPath.trim() ? requestedPath : homedir();

  if (!isAbsolute(targetPath)) {
    throw new InvalidDirectoryPathError(`path must be an absolute path: ${targetPath}`);
  }

  let dirents;
  try {
    dirents = await readdir(targetPath, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") throw new DirectoryNotFoundError(`Directory not found: ${targetPath}`);
    if (code === "ENOTDIR") throw new NotADirectoryError(`Not a directory: ${targetPath}`);
    if (code === "EACCES" || code === "EPERM") {
      throw new DirectoryAccessDeniedError(`Permission denied: ${targetPath}`);
    }
    throw error;
  }

  const directoryDirents = dirents
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const entries: DirectoryEntry[] = [];
  // Only set once the loop stops early because the cap was hit -- NOT
  // whenever entries.length ends up smaller than directoryDirents.length,
  // which also happens whenever a symlink resolves to a non-directory (or a
  // broken symlink) and would falsely read as "there's more, capped".
  let truncated = false;
  for (const dirent of directoryDirents) {
    if (entries.length >= maxEntries) {
      truncated = true;
      break;
    }

    const entryPath = join(targetPath, dirent.name);
    if (dirent.isSymbolicLink()) {
      const stats = await stat(entryPath).catch(() => null);
      if (!stats?.isDirectory()) continue;
    }
    entries.push({ name: dirent.name, path: entryPath, isGitRepo: await hasGitMarker(entryPath) });
  }

  const parent = dirname(targetPath);

  return {
    path: targetPath,
    parentPath: parent === targetPath ? null : parent,
    isGitRepo: await hasGitMarker(targetPath),
    entries,
    truncated,
  };
}
