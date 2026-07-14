import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

const execFileAsync = promisify(execFileCb);

export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string }>;

function defaultExec(file: string, args: string[]): Promise<{ stdout: string }> {
  return execFileAsync(file, args);
}

export class WorktreeError extends Error {}
export class WorktreeConflictError extends WorktreeError {}
export class DirtyWorktreeError extends WorktreeError {}

export function defaultWorktreesRoot(): string {
  return join(homedir(), ".tmux-web", "worktrees");
}

// Mirrors Superset's safeResolveWorktreePath: resolve() collapses any '..'
// segments, then we verify the result is still under <worktreesRoot>/<projectId>
// before it's ever handed to `git worktree add`.
export function resolveWorktreePath(
  projectId: string,
  branchName: string,
  worktreesRoot: string = defaultWorktreesRoot(),
): string {
  const projectRoot = resolve(worktreesRoot, projectId);
  if (projectRoot !== resolve(worktreesRoot) && !projectRoot.startsWith(resolve(worktreesRoot) + sep)) {
    throw new WorktreeError(`Resolved project worktree root escapes worktreesRoot: ${projectRoot}`);
  }

  const worktreePath = resolve(projectRoot, branchName);
  if (worktreePath !== projectRoot && !worktreePath.startsWith(projectRoot + sep)) {
    throw new WorktreeError(`Resolved worktree path escapes the project's worktree root: ${worktreePath}`);
  }

  return worktreePath;
}

export async function isGitRepo(repoPath: string, exec: ExecFn = defaultExec): Promise<boolean> {
  try {
    await exec("git", ["-C", repoPath, "rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export async function pruneWorktrees(repoPath: string, exec: ExecFn = defaultExec): Promise<void> {
  await exec("git", ["-C", repoPath, "worktree", "prune"]);
}

function stderrOf(error: unknown): string {
  return (error as { stderr?: string })?.stderr ?? "";
}

function messageOf(error: unknown): string {
  const stderr = stderrOf(error);
  if (stderr) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}

// Matches the `ref: refs/heads/<branch>\tHEAD` line `git ls-remote --symref`
// prints for the remote's default branch (e.g. "main", "master", "trunk").
const ORIGIN_HEAD_SYMREF_PATTERN = /^ref:\s+refs\/heads\/(\S+)\s+HEAD/m;

export async function resolveOriginDefaultBranch(
  repoPath: string,
  exec: ExecFn = defaultExec,
): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await exec("git", ["-C", repoPath, "ls-remote", "--symref", "origin", "HEAD"]));
  } catch (error) {
    throw new WorktreeError(`Failed to resolve default branch from origin: ${messageOf(error)}`);
  }

  const match = stdout.match(ORIGIN_HEAD_SYMREF_PATTERN);
  if (!match) {
    throw new WorktreeError(`Could not determine origin's default branch from ls-remote output: ${stdout.trim()}`);
  }
  return match[1];
}

export type WorktreeProgressListener = (message: string) => void;

export async function addWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  onProgress?: WorktreeProgressListener,
  exec: ExecFn = defaultExec,
): Promise<void> {
  onProgress?.("Pruning stale worktrees…");
  await pruneWorktrees(repoPath, exec);

  onProgress?.("Resolving default branch from origin…");
  const baseBranch = await resolveOriginDefaultBranch(repoPath, exec);

  onProgress?.(`Fetching origin/${baseBranch}…`);
  try {
    await exec("git", [
      "-C", repoPath,
      "fetch", "origin", `${baseBranch}:refs/remotes/origin/${baseBranch}`,
    ]);
  } catch (error) {
    throw new WorktreeError(`Failed to fetch origin/${baseBranch}: ${messageOf(error)}`);
  }

  onProgress?.("Creating worktree…");
  try {
    await exec("git", [
      "-C", repoPath,
      "worktree", "add", "--no-track", "-b", branchName, worktreePath, `origin/${baseBranch}`,
    ]);
  } catch (error) {
    const stderr = stderrOf(error);
    if (/already exists/i.test(stderr)) {
      throw new WorktreeConflictError(messageOf(error));
    }
    throw new WorktreeError(messageOf(error));
  }
}

export interface RemoveWorktreeOptions {
  force?: boolean;
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  options: RemoveWorktreeOptions = {},
  exec: ExecFn = defaultExec,
): Promise<void> {
  const args = ["-C", repoPath, "worktree", "remove"];
  if (options.force) args.push("--force");
  args.push(worktreePath);

  try {
    await exec("git", args);
  } catch (error) {
    const stderr = stderrOf(error);
    if (/contains modified or untracked files/i.test(stderr)) {
      throw new DirtyWorktreeError(messageOf(error));
    }
    throw new WorktreeError(messageOf(error));
  }
}
