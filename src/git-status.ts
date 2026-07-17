import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

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
}

export interface GroupedChanges {
  staged: ChangedFile[];
  unstaged: ChangedFile[];
  untracked: ChangedFile[];
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

export async function getChangedFiles(
  worktreePath: string,
  exec: ExecFn = defaultExec,
  statFn: StatFn = stat,
): Promise<GroupedChanges> {
  await assertWorktreeExists(worktreePath, statFn);

  const { stdout } = await exec("git", ["-C", worktreePath, "status", "--porcelain=v1", "-z"]);
  const all = parseStatusPorcelain(stdout);

  return {
    staged: all.filter((file) => file.staged && file.status !== "untracked"),
    unstaged: all.filter((file) => !file.staged && file.status !== "untracked"),
    untracked: all.filter((file) => file.status === "untracked"),
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
