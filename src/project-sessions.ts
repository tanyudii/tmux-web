import type { Project } from "./projects.ts";
import { buildSessionName, parseSessionName, belongsToProject } from "./session-naming.ts";
import { resolveWorktreePath } from "./worktree.ts";
import { slugifyBranchName } from "./slug.ts";
import { ValidationError, type TmuxSession, type CreateSessionOptions } from "./tmux.ts";
import type { RemoveWorktreeOptions } from "./worktree.ts";

export interface ProjectSession {
  name: string;
  fullName: string;
  windows: number;
  attached: boolean;
}

export interface ProjectSessionsDeps {
  listSessions: () => Promise<TmuxSession[]>;
  createSession: (name: string, options?: CreateSessionOptions) => Promise<void>;
  killSession: (name: string) => Promise<void>;
  addWorktree: (repoPath: string, worktreePath: string, branchName: string) => Promise<void>;
  removeWorktree: (repoPath: string, worktreePath: string, options?: RemoveWorktreeOptions) => Promise<void>;
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
      attached: session.attached,
    });
  }

  return result;
}

export async function createProjectSession(
  project: Project,
  rawName: string,
  deps: ProjectSessionsDeps,
): Promise<ProjectSession> {
  const sessionSlug = slugifyBranchName(rawName);
  if (!sessionSlug) {
    throw new ValidationError(`Session name has no usable characters: "${rawName}"`);
  }

  const fullName = buildFullNameOrThrowValidation(project, sessionSlug);
  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);

  await deps.addWorktree(project.repoPath, worktreePath, sessionSlug);

  try {
    await deps.createSession(fullName, { cwd: worktreePath });
  } catch (error) {
    // Don't leave an orphaned worktree behind when the tmux side fails.
    await deps.removeWorktree(project.repoPath, worktreePath, { force: true }).catch(() => {});
    throw error;
  }

  return { name: sessionSlug, fullName, windows: 1, attached: false };
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

  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  await deps.removeWorktree(project.repoPath, worktreePath, options);
}
