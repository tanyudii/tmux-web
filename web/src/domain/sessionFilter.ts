// Ports kmp/composeApp/.../domain/SessionFilter.kt (EMB-221): session-list
// status filter. "Status" here means whether the session is currently
// attached -- the only real-time status signal already present on every
// ProjectSession with no extra per-session network round trip.
import type { ProjectSession } from "../api/types";

export type SessionStatusFilter = "all" | "active" | "idle";

/**
 * Pure, DOM-free filter. Branch matching is a case-insensitive substring
 * match against `session.name`, which doubles as the git branch name for
 * every session (see `slugifyBranchName`/`addWorktree` in
 * src/project-sessions.ts) -- there's no separate `branch` field to filter
 * on instead.
 */
export function filterSessions(
  sessions: ProjectSession[],
  statusFilter: SessionStatusFilter,
  branchQuery: string,
): ProjectSession[] {
  const query = branchQuery.trim().toLowerCase();
  return sessions.filter((session) => {
    const matchesStatus =
      statusFilter === "all" ? true : statusFilter === "active" ? session.attached : !session.attached;
    const matchesBranch = query.length === 0 || session.name.toLowerCase().includes(query);
    return matchesStatus && matchesBranch;
  });
}
