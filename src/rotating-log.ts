import { readFile, appendFile, rename, rm, stat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// Shared by access-log.ts (EMB-223) and session-events.ts (EMB-213): both
// append one JSON-line-per-event to a file that must never grow unbounded.
// Extracted once the second caller needed the exact same rotation logic --
// real repetition, not speculative sharing.
export interface RotationOptions {
  maxSizeBytes?: number;
  maxRotatedFiles?: number;
}

// 5 MiB live file, up to 5 rotated generations (.1 through .5) -- bounds
// total disk usage to ~30 MiB regardless of how long the server has been
// running.
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

export async function appendRotatingLogLine(
  filePath: string,
  line: string,
  options: RotationOptions = {},
): Promise<void> {
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const maxRotatedFiles = options.maxRotatedFiles ?? DEFAULT_MAX_ROTATED_FILES;
  await mkdir(dirname(filePath), { recursive: true });
  await rotateIfNeeded(filePath, maxSizeBytes, maxRotatedFiles);
  await appendFile(filePath, `${line}\n`);
}

// Reads only the live (unrotated) file -- rotated generations exist purely
// for retention on disk. Returns newest-first, capped at `limit`.
export async function readRotatingLogLines(filePath: string, limit = 200): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  return lines.slice(-limit).reverse();
}
