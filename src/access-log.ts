import { appendRotatingLogLine, readRotatingLogLines, type RotationOptions } from "./rotating-log.ts";

// EMB-223: audit log of every bearer-token-gated request this server
// receives. Entries carry the acting `userId` where known (undefined for
// denied/unknown-token requests), and GET /api/access-log filters to the
// requesting user's own entries -- with multiple users, the raw log is
// cross-tenant data, not a shared debug view.
export type AccessLogOutcome = "authorized" | "denied";

export interface AccessLogEntry {
  timestamp: string;
  ip: string;
  method: string;
  path: string;
  outcome: AccessLogOutcome;
  userId?: string;
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
