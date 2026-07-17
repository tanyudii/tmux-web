import type { Project } from "./projects.ts";
import { buildSessionName, parseSessionName, belongsToProject } from "./session-naming.ts";
import { resolveWorktreePath } from "./worktree.ts";
import { slugifyBranchName } from "./slug.ts";
import { ValidationError, type TmuxSession, type TmuxWindow, type CreateSessionOptions } from "./tmux.ts";
import type { RemoveWorktreeOptions } from "./worktree.ts";
import type { GroupedChanges, FileDiff, DiffMode } from "./git-status.ts";

export class SessionCreationInProgressError extends Error {}
export class SessionCreationNotFoundError extends Error {}

export type SessionCreationPhase = "creating" | "ready" | "error";

export interface SessionCreationStatus {
  phase: SessionCreationPhase;
  message?: string;
  session?: ProjectSession;
}

export type SessionCreationStore = Map<string, SessionCreationStatus>;

export function createSessionCreationStore(): SessionCreationStore {
  return new Map();
}

export interface ProjectSession {
  name: string;
  fullName: string;
  windows: number;
  // Per-window display names, ordered by tmux window index (best-effort --
  // omitted rather than guessed when the live tmux query fails or isn't
  // available). Lets the client show real tmux window names (see
  // WindowTabs.kt) instead of a placeholder after a page refresh.
  windowNames?: string[];
  attached: boolean;
}

export interface ProjectSessionsDeps {
  listSessions: () => Promise<TmuxSession[]>;
  listWindows: (fullName: string) => Promise<TmuxWindow[]>;
  createSession: (name: string, options?: CreateSessionOptions) => Promise<void>;
  killSession: (name: string) => Promise<void>;
  addWorktree: (repoPath: string, worktreePath: string, branchName: string, onProgress?: (message: string) => void) => Promise<void>;
  removeWorktree: (repoPath: string, worktreePath: string, options?: RemoveWorktreeOptions) => Promise<void>;
  getChangedFiles: (worktreePath: string) => Promise<GroupedChanges>;
  getFileDiff: (worktreePath: string, filePath: string, mode: DiffMode) => Promise<FileDiff>;
  stageFile: (worktreePath: string, filePath: string) => Promise<void>;
  unstageFile: (worktreePath: string, filePath: string) => Promise<void>;
  discardFile: (worktreePath: string, filePath: string, mode: DiffMode) => Promise<void>;
  commitStaged: (worktreePath: string, message: string) => Promise<void>;
  // Optional: tears down the session's docker-compose environment (see
  // session-env.ts). Best-effort -- a session with no environment, or a
  // docker daemon that's gone away, must not block killing the session.
  stopSessionEnv?: (project: Project, sessionSlug: string) => Promise<void>;
  worktreesRoot?: string;
}

// "no server running" covers the case where the session being killed was
// the tmux server's last one -- the server process exits with it, so a
// retry sees "no server running" rather than "can't find session".
const SESSION_ALREADY_GONE_PATTERN = /can't find session|session not found|no server running/i;

function buildFullNameOrThrowValidation(project: Project, sessionSlug: string): string {
  try {
    return buildSessionName(project.id, sessionSlug);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error));
  }
}

function resolveSessionIdentity(project: Project, rawName: string): { sessionSlug: string; fullName: string } {
  const sessionSlug = slugifyBranchName(rawName);
  if (!sessionSlug) {
    throw new ValidationError(`Session name has no usable characters: "${rawName}"`);
  }
  return { sessionSlug, fullName: buildFullNameOrThrowValidation(project, sessionSlug) };
}

export async function listProjectSessions(
  project: Project,
  deps: ProjectSessionsDeps,
): Promise<ProjectSession[]> {
  const allSessions = await deps.listSessions();
  const result: ProjectSession[] = [];

  for (const session of allSessions) {
    if (!belongsToProject(session.name, project.id)) continue;
    const parsed = parseSessionName(session.name);
    result.push({
      name: parsed?.sessionSlug ?? session.name,
      fullName: session.name,
      windows: session.windows,
      windowNames: await fetchWindowNames(session.name, deps),
      attached: session.attached,
    });
  }

  return result;
}

// Best-effort: a session that vanishes between deps.listSessions() and this
// call (or any other tmux error) must not fail the whole listing -- window
// names are supplementary display data, not load-bearing.
async function fetchWindowNames(fullName: string, deps: ProjectSessionsDeps): Promise<string[] | undefined> {
  try {
    const windows = await deps.listWindows(fullName);
    return windows.map((window) => window.name);
  } catch {
    return undefined;
  }
}

export async function createProjectSession(
  project: Project,
  rawName: string,
  deps: ProjectSessionsDeps,
  onProgress?: (message: string) => void,
): Promise<ProjectSession> {
  const { sessionSlug, fullName } = resolveSessionIdentity(project, rawName);
  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);

  await deps.addWorktree(project.repoPath, worktreePath, sessionSlug, onProgress);

  try {
    onProgress?.("Starting tmux session…");
    await deps.createSession(fullName, { cwd: worktreePath });
  } catch (error) {
    // Don't leave an orphaned worktree behind when the tmux side fails.
    await deps.removeWorktree(project.repoPath, worktreePath, { force: true }).catch(() => {});
    throw error;
  }

  return { name: sessionSlug, fullName, windows: 1, attached: false };
}

// Fast entry point: claims the store slot synchronously (mirroring
// startSessionEnv's TOCTOU-avoidance in session-env.ts), then kicks off
// createProjectSession in the background so the HTTP layer can return
// immediately. Progress and outcome are observed by polling
// getSessionCreationStatus, which reads the store entries set below.
export async function startProjectSessionCreation(
  project: Project,
  rawName: string,
  deps: ProjectSessionsDeps,
  store: SessionCreationStore,
): Promise<{ name: string; fullName: string }> {
  const { sessionSlug, fullName } = resolveSessionIdentity(project, rawName);

  if (store.get(fullName)?.phase === "creating") {
    throw new SessionCreationInProgressError(`Session "${sessionSlug}" is already being created`);
  }
  // Claim the slot synchronously -- no `await` before this -- so a second,
  // truly concurrent create for the same slug can never slip through the
  // gap (same TOCTOU-avoidance as startSessionEnv in session-env.ts).
  store.set(fullName, { phase: "creating" });

  void runSessionCreation(project, sessionSlug, fullName, deps, store);

  return { name: sessionSlug, fullName };
}

async function runSessionCreation(
  project: Project,
  sessionSlug: string,
  fullName: string,
  deps: ProjectSessionsDeps,
  store: SessionCreationStore,
): Promise<void> {
  try {
    const session = await createProjectSession(project, sessionSlug, deps, (message) => {
      store.set(fullName, { phase: "creating", message });
    });
    store.set(fullName, { phase: "ready", session });
  } catch (error) {
    store.set(fullName, {
      phase: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getSessionCreationStatus(
  project: Project,
  sessionSlug: string,
  store: SessionCreationStore,
): Promise<SessionCreationStatus> {
  const fullName = buildFullNameOrThrowValidation(project, sessionSlug);
  const status = store.get(fullName);
  if (!status) {
    throw new SessionCreationNotFoundError(`No session creation in progress for "${sessionSlug}"`);
  }
  return status;
}

export async function killProjectSession(
  project: Project,
  sessionSlug: string,
  deps: ProjectSessionsDeps,
  options: RemoveWorktreeOptions = {},
): Promise<void> {
  const fullName = buildFullNameOrThrowValidation(project, sessionSlug);

  try {
    await deps.killSession(fullName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Tolerate the session already being gone -- e.g. a retried force-delete
    // after an earlier attempt killed the session but failed to remove a
    // dirty worktree.
    if (!SESSION_ALREADY_GONE_PATTERN.test(message)) throw error;
  }

  if (deps.stopSessionEnv) {
    await deps.stopSessionEnv(project, sessionSlug).catch(() => {});
  }

  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  await deps.removeWorktree(project.repoPath, worktreePath, options);
}

export async function getProjectSessionChanges(
  project: Project,
  sessionSlug: string,
  deps: ProjectSessionsDeps,
): Promise<GroupedChanges> {
  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  return deps.getChangedFiles(worktreePath);
}

export async function getProjectSessionDiff(
  project: Project,
  sessionSlug: string,
  filePath: string,
  mode: DiffMode,
  deps: ProjectSessionsDeps,
): Promise<FileDiff> {
  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  return deps.getFileDiff(worktreePath, filePath, mode);
}

export async function stageProjectSessionFile(
  project: Project,
  sessionSlug: string,
  filePath: string,
  deps: ProjectSessionsDeps,
): Promise<void> {
  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  return deps.stageFile(worktreePath, filePath);
}

export async function unstageProjectSessionFile(
  project: Project,
  sessionSlug: string,
  filePath: string,
  deps: ProjectSessionsDeps,
): Promise<void> {
  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  return deps.unstageFile(worktreePath, filePath);
}

export async function discardProjectSessionFile(
  project: Project,
  sessionSlug: string,
  filePath: string,
  mode: DiffMode,
  deps: ProjectSessionsDeps,
): Promise<void> {
  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  return deps.discardFile(worktreePath, filePath, mode);
}

export async function commitProjectSessionChanges(
  project: Project,
  sessionSlug: string,
  message: string,
  deps: ProjectSessionsDeps,
): Promise<void> {
  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  return deps.commitStaged(worktreePath, message);
}
