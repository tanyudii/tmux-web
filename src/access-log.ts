import { appendRotatingLogLine, readRotatingLogLines, type RotationOptions } from "./rotating-log.ts";

// EMB-223: audit log of every bearer-token-gated request this server
// receives. The token is shared (not per-user, see server.ts's ServerDeps
// doc comment and the README), so this identifies *what happened when from
// which IP* -- not *who* in any personal sense. That limitation is
// deliberate and documented, not an oversight.
export type AccessLogOutcome = "authorized" | "denied";

export interface AccessLogEntry {
  timestamp: string;
  ip: string;
  method: string;
  path: string;
  outcome: AccessLogOutcome;
}

export type AccessLogRotationOptions = RotationOptions;

export async function appendAccessLogEntry(
  filePath: string,
  entry: AccessLogEntry,
  options: AccessLogRotationOptions = {},
): Promise<void> {
  await appendRotatingLogLine(filePath, JSON.stringify(entry), options);
}

// Reads only the live (unrotated) file -- rotated generations exist purely
// for retention on disk, not for the "recent activity" viewer this backs
// (GET /api/access-log). Returns newest-first, capped at `limit`.
export async function readAccessLog(filePath: string, limit = 200): Promise<AccessLogEntry[]> {
  return (await readRotatingLogLines(filePath, limit)).map((line) => JSON.parse(line) as AccessLogEntry);
}
