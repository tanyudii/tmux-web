import { appendRotatingLogLine, readRotatingLogLines, type RotationOptions } from "./rotating-log.ts";

// EMB-213: lifecycle history for a session (create -> env setup -> env
// stop -> delete), so "why is this session like this" is answerable from
// the UI instead of raw server logs. One JSON-lines file per PROJECT (not
// per session, not one global file) -- matches the ticket's own "per
// project" call and this app's existing convention of scoping runtime data
// files by project (see projects.ts/session-templates.ts).
export type SessionEventType =
  | "created"
  | "env_setup_started"
  | "env_setup_finished"
  | "env_setup_failed"
  | "env_stopped"
  | "deleted";

export interface SessionEvent {
  timestamp: string;
  projectId: string;
  sessionSlug: string;
  type: SessionEventType;
  message?: string;
}

export type SessionEventsRotationOptions = RotationOptions;

export async function appendSessionEvent(
  filePath: string,
  event: SessionEvent,
  options: SessionEventsRotationOptions = {},
): Promise<void> {
  await appendRotatingLogLine(filePath, JSON.stringify(event), options);
}

// The project's events file interleaves every session's events, so this
// reads the whole (rotation-capped, at most a few MiB) live file rather than
// just the tail -- an older session's history must not get crowded out of
// the result by a busy sibling session that's had many more recent events.
export async function readSessionEvents(
  filePath: string,
  sessionSlug: string,
  limit = 200,
): Promise<SessionEvent[]> {
  const lines = await readRotatingLogLines(filePath, Number.MAX_SAFE_INTEGER);
  return lines
    .map((line) => JSON.parse(line) as SessionEvent)
    .filter((event) => event.sessionSlug === sessionSlug)
    .slice(0, limit);
}
