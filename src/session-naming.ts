import { createHash } from "node:crypto";

export const SESSION_NAME_SEPARATOR = "__";
const MAX_TMUX_SESSION_NAME_LENGTH = 64;

export interface ParsedSessionName {
  projectId: string;
  sessionSlug: string;
}

export function buildSessionName(projectId: string, sessionSlug: string): string {
  if (projectId.includes(SESSION_NAME_SEPARATOR) || sessionSlug.includes(SESSION_NAME_SEPARATOR)) {
    throw new Error("projectId and sessionSlug must not contain the '__' separator");
  }
  const fullName = `${projectId}${SESSION_NAME_SEPARATOR}${sessionSlug}`;
  if (fullName.length > MAX_TMUX_SESSION_NAME_LENGTH) {
    throw new Error(
      `Composite session name exceeds tmux's ${MAX_TMUX_SESSION_NAME_LENGTH}-character limit: ${fullName}`,
    );
  }
  return fullName;
}

export function parseSessionName(fullName: string): ParsedSessionName | null {
  const separatorIndex = fullName.indexOf(SESSION_NAME_SEPARATOR);
  if (separatorIndex <= 0) return null;

  const projectId = fullName.slice(0, separatorIndex);
  const sessionSlug = fullName.slice(separatorIndex + SESSION_NAME_SEPARATOR.length);
  if (!sessionSlug) return null;

  return { projectId, sessionSlug };
}

export function belongsToProject(fullName: string, projectId: string): boolean {
  return fullName.startsWith(`${projectId}${SESSION_NAME_SEPARATOR}`);
}

// EMB-217 split-pane: the second viewport attaches to a tmux *linked
// session* (`tmux new-session -t <fullName> -s <this name>`) rather than
// the primary session directly -- linked sessions share the exact same
// underlying windows/panes (same processes, same content) but each tracks
// its own independent "current window", confirmed live: selecting a
// different window in one linked session does not affect another linked
// to the same source. That's exactly what lets the split viewport show a
// different window than the primary one, side by side, while both remain
// views onto the same live session.
//
// Hash-derived (not `${fullName}--split`) so the result always fits
// isValidSessionName's 64-char cap regardless of fullName's own length --
// buildSessionName already allows fullName up to that same 64-char limit,
// leaving no room for a readable suffix in the worst case. A fixed-length
// hash sidesteps that entirely; the tradeoff (not human-readable, not
// parseable back to fullName) is fine since nothing needs to reverse it --
// see project-sessions.ts's SplitPaneStore, which tracks the mapping the
// other direction instead.
export function splitPaneSessionName(fullName: string): string {
  const hash = createHash("sha256").update(fullName).digest("hex").slice(0, 20);
  return `split-${hash}`;
}
