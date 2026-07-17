import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

const execFileAsync = promisify(execFileCb);

export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string }>;

function defaultExec(file: string, args: string[]): Promise<{ stdout: string }> {
  return execFileAsync(file, args);
}

export class GitStatusError extends Error {}
export class WorktreeNotFoundError extends Error {}
export class NothingStagedError extends GitStatusError {}

export type FileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  staged: boolean;
  // Only ever present (and true) for an unmerged file mid-conflict -- never
  // set to false, so existing deepEqual-style assertions on non-conflicted
  // ChangedFile objects don't need an explicit `conflicted: false`.
  conflicted?: boolean;
}

export type RepoState = "clean" | "merging" | "rebasing";

export interface GroupedChanges {
  staged: ChangedFile[];
  unstaged: ChangedFile[];
  untracked: ChangedFile[];
  conflicted: ChangedFile[];
  repoState: RepoState;
}

export type DiffMode = "staged" | "unstaged" | "untracked";

export interface FileDiff {
  diff: string;
  isUntracked: boolean;
  isBinary: boolean;
}

function mapStatusChar(char: string): FileStatus | null {
  switch (char) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
    case "C":
      return "renamed";
    case "U":
      // Unmerged/conflict state -- no dedicated status in our simplified
      // model, "modified" is the closest honest fallback.
      return "modified";
    default:
      return null;
  }
}

// The full set of XY combinations `git status --porcelain` uses to mark an
// unmerged (conflicted) path -- see git-status(1)'s "Unmerged" table.
const UNMERGED_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

// Parses `git status --porcelain=v1 -z` output. Each record is "XY PATH\0",
// where a rename/copy record is followed by one extra NUL-terminated field
// (the old path) that MUST be consumed even when unused, or every record
// after it in the stream would be misread.
export function parseStatusPorcelain(output: string): ChangedFile[] {
  const fields = output.split("\0").filter((field) => field.length > 0);
  const result: ChangedFile[] = [];

  let i = 0;
  while (i < fields.length) {
    const entry = fields[i];
    i++;

    const x = entry[0];
    const y = entry[1];
    const path = entry.slice(3);

    const isRenameOrCopy = x === "R" || x === "C" || y === "R" || y === "C";
    const oldPath = isRenameOrCopy ? fields[i] : undefined;
    if (isRenameOrCopy) i++;

    if (x === "?" && y === "?") {
      result.push({ path, status: "untracked", staged: false, oldPath: undefined });
      continue;
    }

    if (UNMERGED_CODES.has(`${x}${y}`)) {
      // A single entry, not one per staged/unstaged side: an unmerged path
      // isn't meaningfully "staged" or "unstaged" the way a normal change
      // is, and the old per-char mapping used to push it into BOTH buckets
      // (mapStatusChar('U') fell back to "modified" on both sides), showing
      // the same conflicted file twice. See getChangedFiles's `conflicted`
      // bucket -- EMB-208.
      result.push({ path, status: "modified", staged: false, oldPath, conflicted: true });
      continue;
    }

    const stagedStatus = mapStatusChar(x);
    if (stagedStatus) {
      result.push({ path, status: stagedStatus, staged: true, oldPath });
    }

    const unstagedStatus = mapStatusChar(y);
    if (unstagedStatus) {
      result.push({ path, status: unstagedStatus, staged: false, oldPath });
    }
  }

  return result;
}

export type StatFn = (path: string) => Promise<{ isDirectory(): boolean }>;

async function assertWorktreeExists(worktreePath: string, statFn: StatFn): Promise<void> {
  try {
    const stats = await statFn(worktreePath);
    if (!stats.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new WorktreeNotFoundError(`Worktree not found: ${worktreePath}`);
  }
}

export type ReadFileFn = (path: string) => Promise<string>;

function defaultReadFile(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

// Resolves a worktree's real git-dir without shelling out to git. A linked
// worktree's `.git` is a FILE containing "gitdir: <path>" (possibly
// relative -- see `git worktree add`'s docs), not a directory, so a plain
// `<worktreePath>/.git/MERGE_HEAD` check would look in the wrong place.
// Returns null (never throws) on anything unexpected -- this only feeds a
// UI hint, not a value anything correctness-critical depends on.
async function resolveGitDir(worktreePath: string, readFileFn: ReadFileFn, statFn: StatFn): Promise<string | null> {
  const dotGitPath = join(worktreePath, ".git");
  try {
    const stats = await statFn(dotGitPath);
    if (stats.isDirectory()) return dotGitPath;
  } catch {
    return null;
  }
  try {
    const content = await readFileFn(dotGitPath);
    const match = /^gitdir:\s*(.+)$/m.exec(content);
    if (!match) return null;
    const gitDir = match[1].trim();
    return isAbsolute(gitDir) ? gitDir : resolve(worktreePath, gitDir);
  } catch {
    return null;
  }
}

/** Detects mid-rebase/mid-merge repo state for the Changes sidebar banner (EMB-208). */
export async function getRepoState(
  worktreePath: string,
  readFileFn: ReadFileFn = defaultReadFile,
  statFn: StatFn = stat,
): Promise<RepoState> {
  const gitDir = await resolveGitDir(worktreePath, readFileFn, statFn);
  if (!gitDir) return "clean";

  const exists = (name: string) =>
    statFn(join(gitDir, name))
      .then(() => true)
      .catch(() => false);

  if ((await exists("rebase-merge")) || (await exists("rebase-apply"))) return "rebasing";
  if (await exists("MERGE_HEAD")) return "merging";
  return "clean";
}

export async function getChangedFiles(
  worktreePath: string,
  exec: ExecFn = defaultExec,
  statFn: StatFn = stat,
  readFileFn: ReadFileFn = defaultReadFile,
): Promise<GroupedChanges> {
  await assertWorktreeExists(worktreePath, statFn);

  const { stdout } = await exec("git", ["-C", worktreePath, "status", "--porcelain=v1", "-z"]);
  const all = parseStatusPorcelain(stdout);
  const repoState = await getRepoState(worktreePath, readFileFn, statFn);

  return {
    staged: all.filter((file) => file.staged && file.status !== "untracked" && !file.conflicted),
    unstaged: all.filter((file) => !file.staged && file.status !== "untracked" && !file.conflicted),
    untracked: all.filter((file) => file.status === "untracked"),
    conflicted: all.filter((file) => file.conflicted === true),
    repoState,
  };
}

function resolveSafeFilePath(worktreePath: string, filePath: string): string {
  const resolved = resolve(worktreePath, filePath);
  if (resolved !== worktreePath && !resolved.startsWith(worktreePath + sep)) {
    throw new GitStatusError(`Resolved file path escapes the worktree: ${resolved}`);
  }
  return resolved;
}

const BINARY_SNIFF_BYTES = 8000;
const BINARY_DIFF_PATTERN = /^Binary files .* differ/m;

export async function getFileDiff(
  worktreePath: string,
  filePath: string,
  mode: DiffMode,
  exec: ExecFn = defaultExec,
): Promise<FileDiff> {
  const safePath = resolveSafeFilePath(worktreePath, filePath);

  if (mode === "untracked") {
    let buffer: Buffer;
    try {
      buffer = await readFile(safePath);
    } catch (error) {
      throw new GitStatusError(
        `Could not read untracked file: ${filePath} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const isBinary = buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
    return { diff: isBinary ? "" : buffer.toString("utf-8"), isUntracked: true, isBinary };
  }

  const args = ["-C", worktreePath, "diff"];
  if (mode === "staged") args.push("--cached");
  args.push("--", filePath);

  const { stdout } = await exec("git", args);
  const isBinary = BINARY_DIFF_PATTERN.test(stdout);
  return { diff: isBinary ? "" : stdout, isUntracked: false, isBinary };
}

export async function stageFile(
  worktreePath: string,
  filePath: string,
  exec: ExecFn = defaultExec,
): Promise<void> {
  resolveSafeFilePath(worktreePath, filePath);
  await exec("git", ["-C", worktreePath, "add", "--", filePath]);
}

export async function unstageFile(
  worktreePath: string,
  filePath: string,
  exec: ExecFn = defaultExec,
): Promise<void> {
  resolveSafeFilePath(worktreePath, filePath);
  await exec("git", ["-C", worktreePath, "restore", "--staged", "--", filePath]);
}

const NOT_IN_HEAD_PATTERN = /did not match any file/i;

export async function discardFile(
  worktreePath: string,
  filePath: string,
  mode: DiffMode,
  exec: ExecFn = defaultExec,
): Promise<void> {
  const safePath = resolveSafeFilePath(worktreePath, filePath);

  if (mode === "untracked") {
    await rm(safePath, { force: true });
    return;
  }

  try {
    // Resets both the index and the working tree for this path back to
    // HEAD in one shot, so a file with both staged and unstaged changes is
    // fully discarded regardless of which section (staged/unstaged) the
    // user discarded from.
    await exec("git", ["-C", worktreePath, "checkout", "HEAD", "--", filePath]);
  } catch (error) {
    // The path doesn't exist in HEAD yet (a newly staged/added file), so
    // there's nothing for "checkout HEAD" to restore from -- discarding it
    // means unstaging it and deleting it from disk instead.
    const message = error instanceof Error ? error.message : String(error);
    if (!NOT_IN_HEAD_PATTERN.test(message)) throw error;
    await exec("git", ["-C", worktreePath, "reset", "--", filePath]);
    await rm(safePath, { force: true });
  }
}

const NOTHING_STAGED_PATTERN = /nothing to commit|nothing added to commit/i;

export async function commitStaged(
  worktreePath: string,
  message: string,
  exec: ExecFn = defaultExec,
): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) throw new GitStatusError("Commit message must not be empty");

  try {
    await exec("git", ["-C", worktreePath, "commit", "-m", trimmed]);
  } catch (error) {
    if (NOTHING_STAGED_PATTERN.test(execErrorOutput(error))) {
      throw new NothingStagedError("No staged changes to commit");
    }
    throw error;
  }
}

// Node's child_process exec error carries the command's stdout/stderr as
// extra properties on the Error, NOT folded into `.message` (which is just
// "Command failed: <cmd>") -- and git prints "nothing to commit" to STDOUT,
// not stderr, so checking `.message` alone silently never matches it.
function execErrorOutput(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { stdout, stderr } = error as Error & { stdout?: unknown; stderr?: unknown };
  return [error.message, typeof stdout === "string" ? stdout : "", typeof stderr === "string" ? stderr : ""].join("\n");
}
