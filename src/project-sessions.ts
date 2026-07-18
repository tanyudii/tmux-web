import type { Project } from "./projects.ts";
import { buildSessionName, parseSessionName, belongsToProject, splitPaneSessionName } from "./session-naming.ts";
import { resolveWorktreePath } from "./worktree.ts";
import { slugifyBranchName } from "./slug.ts";
import { ValidationError, type TmuxSession, type TmuxWindow, type CreateSessionOptions } from "./tmux.ts";
import type { RemoveWorktreeOptions } from "./worktree.ts";
import type { GroupedChanges, FileDiff, DiffMode } from "./git-status.ts";
import type { EnvFileEntry } from "./env-editor.ts";
import type { SessionEventType } from "./session-events.ts";
import type { SessionMeta } from "./session-meta.ts";

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
  // EMB-222: short free-text organizational label + favorite flag,
  // persisted in session-meta.ts. Absent/false for sessions nobody has
  // labeled/favorited -- existing sessions need no migration.
  label?: string;
  favorite: boolean;
}

export interface ProjectSessionsDeps {
  listSessions: () => Promise<TmuxSession[]>;
  listWindows: (fullName: string) => Promise<TmuxWindow[]>;
  createSession: (name: string, options?: CreateSessionOptions) => Promise<void>;
  killSession: (name: string) => Promise<void>;
  // EMB-220: types a session template's optional startup command into the
  // new session's first window right after creation.
  sendKeys: (name: string, text: string) => Promise<void>;
  addWorktree: (repoPath: string, worktreePath: string, branchName: string, onProgress?: (message: string) => void) => Promise<void>;
  removeWorktree: (repoPath: string, worktreePath: string, options?: RemoveWorktreeOptions) => Promise<void>;
  // EMB-207 auto-delete branch on session delete.
  isBranchMerged: (repoPath: string, branchName: string) => Promise<boolean>;
  deleteBranch: (repoPath: string, branchName: string) => Promise<void>;
  getChangedFiles: (worktreePath: string) => Promise<GroupedChanges>;
  getFileDiff: (worktreePath: string, filePath: string, mode: DiffMode) => Promise<FileDiff>;
  stageFile: (worktreePath: string, filePath: string) => Promise<void>;
  unstageFile: (worktreePath: string, filePath: string) => Promise<void>;
  discardFile: (worktreePath: string, filePath: string, mode: DiffMode) => Promise<void>;
  commitStaged: (worktreePath: string, message: string) => Promise<void>;
  listEnvFiles: (worktreePath: string) => Promise<EnvFileEntry[]>;
  readEnvFile: (worktreePath: string, filename: string) => Promise<string>;
  writeEnvFile: (worktreePath: string, filename: string, content: string) => Promise<void>;
  // Optional: tears down the session's docker-compose environment (see
  // session-env.ts). Best-effort -- a session with no environment, or a
  // docker daemon that's gone away, must not block killing the session.
  stopSessionEnv?: (project: Project, sessionSlug: string) => Promise<void>;
  // EMB-213: appends a lifecycle event ("created"/"deleted" from here --
  // env-related types come from session-env.ts's own deps). Optional and
  // best-effort, same reasoning as stopSessionEnv above: a logging failure
  // must never block the actual session operation.
  recordEvent?: (projectId: string, sessionSlug: string, type: SessionEventType, message?: string) => Promise<void>;
  worktreesRoot?: string;
  // EMB-222: bulk-loads label/favorite metadata for every session in the
  // project in ONE read (see session-meta.ts), looked up per session in
  // listProjectSessions's loop below rather than one file read per
  // session. Optional/best-effort like stopSessionEnv/recordEvent above --
  // sessions just show no label/favorite if this isn't wired up.
  listSessionMeta?: (projectId: string) => Promise<SessionMeta[]>;
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
  const metaBySlug = await loadMetaBySlug(project.id, deps);
  const result: ProjectSession[] = [];

  for (const session of allSessions) {
    if (!belongsToProject(session.name, project.id)) continue;
    const parsed = parseSessionName(session.name);
    const sessionSlug = parsed?.sessionSlug ?? session.name;
    const meta = metaBySlug.get(sessionSlug);
    result.push({
      name: sessionSlug,
      fullName: session.name,
      windows: session.windows,
      windowNames: await fetchWindowNames(session.name, deps),
      attached: session.attached,
      label: meta?.label,
      favorite: meta?.favorite ?? false,
    });
  }

  return result;
}

async function loadMetaBySlug(projectId: string, deps: ProjectSessionsDeps): Promise<Map<string, SessionMeta>> {
  if (!deps.listSessionMeta) return new Map();
  const entries = await deps.listSessionMeta(projectId);
  return new Map(entries.map((entry) => [entry.sessionSlug, entry]));
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
  startupCommand?: string,
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

  // Best-effort: a startup command that fails to send must never fail
  // session creation itself -- the session and worktree are already real
  // and usable at this point, this is just a convenience typed on the
  // user's behalf.
  if (startupCommand) {
    onProgress?.("Running startup command…");
    await deps.sendKeys(fullName, startupCommand).catch(() => {});
  }

  await deps.recordEvent?.(project.id, sessionSlug, "created").catch(() => {});

  return { name: sessionSlug, fullName, windows: 1, attached: false, favorite: false };
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
  startupCommand?: string,
): Promise<{ name: string; fullName: string }> {
  const { sessionSlug, fullName } = resolveSessionIdentity(project, rawName);

  if (store.get(fullName)?.phase === "creating") {
    throw new SessionCreationInProgressError(`Session "${sessionSlug}" is already being created`);
  }
  // Claim the slot synchronously -- no `await` before this -- so a second,
  // truly concurrent create for the same slug can never slip through the
  // gap (same TOCTOU-avoidance as startSessionEnv in session-env.ts).
  store.set(fullName, { phase: "creating" });

  void runSessionCreation(project, sessionSlug, fullName, deps, store, startupCommand);

  return { name: sessionSlug, fullName };
}

async function runSessionCreation(
  project: Project,
  sessionSlug: string,
  fullName: string,
  deps: ProjectSessionsDeps,
  store: SessionCreationStore,
  startupCommand?: string,
): Promise<void> {
  try {
    const session = await createProjectSession(
      project,
      sessionSlug,
      deps,
      (message) => {
        store.set(fullName, { phase: "creating", message });
      },
      startupCommand,
    );
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

export interface KillProjectSessionOptions extends RemoveWorktreeOptions {
  // EMB-207: after the worktree is removed, also force-delete the branch
  // (git branch -D) that was created for this session. The frontend is
  // responsible for the two-tier confirmation this implies (default OFF,
  // plus a distinct warning for an unmerged branch via
  // isProjectSessionBranchMerged below) *before* setting this -- by the
  // time this flag is true, the caller has already gotten whatever
  // confirmation it needed, so this always force-deletes unconditionally.
  deleteBranch?: boolean;
}

export async function killProjectSession(
  project: Project,
  sessionSlug: string,
  deps: ProjectSessionsDeps,
  options: KillProjectSessionOptions = {},
): Promise<void> {
  const fullName = buildFullNameOrThrowValidation(project, sessionSlug);

  // Best-effort, and killed before the primary session below: a split
  // pane's linked session (see splitPaneSessionName) shares the primary's
  // windows rather than owning independent ones -- killing it first avoids
  // leaving it as a dangling, no-longer-discoverable session holding those
  // windows open after the primary and worktree are already gone.
  await deps.killSession(splitPaneSessionName(fullName)).catch(() => {});

  // Stop the environment (docker compose down -v, potentially slow) before
  // killing the tmux session -- not the other way around. Killing the
  // session closes the client's attached /ws immediately (see
  // pty-bridge.ts's term.onExit), and a client that's still watching this
  // session has no way to tell that close apart from a transient drop, so
  // it retries against a session that's already gone for as long as this
  // request keeps running. Doing the slow teardown first keeps that window
  // as small as possible -- the two have no ordering dependency on each
  // other (tmux and the session's containers are independent).
  if (deps.stopSessionEnv) {
    await deps.stopSessionEnv(project, sessionSlug).catch(() => {});
  }

  try {
    await deps.killSession(fullName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Tolerate the session already being gone -- e.g. a retried force-delete
    // after an earlier attempt killed the session but failed to remove a
    // dirty worktree.
    if (!SESSION_ALREADY_GONE_PATTERN.test(message)) throw error;
  }

  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  await deps.removeWorktree(project.repoPath, worktreePath, options);

  if (options.deleteBranch) {
    await deps.deleteBranch(project.repoPath, sessionSlug);
  }

  await deps.recordEvent?.(project.id, sessionSlug, "deleted").catch(() => {});
}

// EMB-207: backs the "Delete branch too" checkbox's warning UI -- called
// (read-only, no deletion) before the user commits to deleting a session's
// branch, so an unmerged branch can be flagged with an extra confirmation
// step *before* anything destructive happens, not discovered after.
export async function isProjectSessionBranchMerged(
  project: Project,
  sessionSlug: string,
  deps: ProjectSessionsDeps,
): Promise<boolean> {
  return deps.isBranchMerged(project.repoPath, sessionSlug);
}

// Closing a split pane in the UI (as opposed to a network blip / tab close,
// which should leave it attachable again -- see main.ts's /ws handler)
// tears down its linked tmux session outright, matching how the split is
// modeled as ephemeral in the UI: reopening it re-creates the linked
// session via ensureLinkedSession (tmux.ts) rather than reusing state.
// Tolerates the split never having been opened at all (nothing to kill).
export async function killProjectSessionSplit(
  project: Project,
  sessionSlug: string,
  deps: ProjectSessionsDeps,
): Promise<void> {
  const fullName = buildFullNameOrThrowValidation(project, sessionSlug);
  await deps.killSession(splitPaneSessionName(fullName)).catch(() => {});
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

export async function listProjectSessionEnvFiles(
  project: Project,
  sessionSlug: string,
  deps: ProjectSessionsDeps,
): Promise<EnvFileEntry[]> {
  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  return deps.listEnvFiles(worktreePath);
}

export async function readProjectSessionEnvFile(
  project: Project,
  sessionSlug: string,
  filename: string,
  deps: ProjectSessionsDeps,
): Promise<string> {
  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  return deps.readEnvFile(worktreePath, filename);
}

export async function writeProjectSessionEnvFile(
  project: Project,
  sessionSlug: string,
  filename: string,
  content: string,
  deps: ProjectSessionsDeps,
): Promise<void> {
  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  return deps.writeEnvFile(worktreePath, filename, content);
}
