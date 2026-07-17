import { readFile, appendFile, rename, rm, stat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

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

export interface AccessLogRotationOptions {
  maxSizeBytes?: number;
  maxRotatedFiles?: number;
}

// 5 MiB live file, up to 5 rotated generations (.1 through .5) -- bounds
// total disk usage to ~30 MiB regardless of how long the server has been
// running, satisfying the "must not grow unbounded" acceptance criterion.
const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ROTATED_FILES = 5;

async function fileSizeOrZero(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return 0;
    throw error;
  }
}

// logrotate-style shift: the oldest generation is dropped, every other
// generation's suffix increments by one, then the live file becomes `.1`.
// Best-effort on the shifts themselves (a missing intermediate generation
// -- e.g. right after the very first rotation -- is not an error).
async function rotateIfNeeded(filePath: string, maxSizeBytes: number, maxRotatedFiles: number): Promise<void> {
  if (maxRotatedFiles < 1) return;
  const size = await fileSizeOrZero(filePath);
  if (size < maxSizeBytes) return;

  await rm(`${filePath}.${maxRotatedFiles}`, { force: true });
  for (let generation = maxRotatedFiles - 1; generation >= 1; generation--) {
    await rename(`${filePath}.${generation}`, `${filePath}.${generation + 1}`).catch(() => {});
  }
  await rename(filePath, `${filePath}.1`);
}

export async function appendAccessLogEntry(
  filePath: string,
  entry: AccessLogEntry,
  options: AccessLogRotationOptions = {},
): Promise<void> {
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const maxRotatedFiles = options.maxRotatedFiles ?? DEFAULT_MAX_ROTATED_FILES;
  await mkdir(dirname(filePath), { recursive: true });
  await rotateIfNeeded(filePath, maxSizeBytes, maxRotatedFiles);
  await appendFile(filePath, `${JSON.stringify(entry)}\n`);
}

// Reads only the live (unrotated) file -- rotated generations exist purely
// for retention on disk, not for the "recent activity" viewer this backs
// (GET /api/access-log). Returns newest-first, capped at `limit`.
export async function readAccessLog(filePath: string, limit = 200): Promise<AccessLogEntry[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  return lines
    .slice(-limit)
    .map((line) => JSON.parse(line) as AccessLogEntry)
    .reverse();
}
