import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// EMB-222: per-session organizational metadata (a short free-text label
// and a favorite flag) -- same "single JSON array on disk, filtered by
// projectId in memory" shape and write-then-rename persistence as
// session-templates.ts/projects.ts. Sessions nobody has labeled/favorited
// simply have no entry here (see setSessionMeta's prune-on-default logic
// below), so existing sessions need no migration and the file never grows
// with dead {label: undefined, favorite: false} records.
export interface SessionMeta {
  projectId: string;
  sessionSlug: string;
  label?: string;
  favorite: boolean;
}

export async function loadSessionMeta(filePath: string): Promise<SessionMeta[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionMeta[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
}

export async function saveSessionMeta(filePath: string, entries: SessionMeta[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  // Write-then-rename keeps concurrent readers from ever seeing a
  // half-written file -- same pattern as projects.ts's saveProjects.
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, JSON.stringify(entries, null, 2));
  await rename(tempPath, filePath);
}

export async function listProjectSessionMeta(filePath: string, projectId: string): Promise<SessionMeta[]> {
  return (await loadSessionMeta(filePath)).filter((entry) => entry.projectId === projectId);
}

function normalizeLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim();
  return trimmed ? trimmed : undefined;
}

export async function setSessionMeta(
  filePath: string,
  projectId: string,
  sessionSlug: string,
  label: string | undefined,
  favorite: boolean,
): Promise<SessionMeta> {
  const entries = await loadSessionMeta(filePath);
  const index = entries.findIndex((entry) => entry.projectId === projectId && entry.sessionSlug === sessionSlug);
  const updated: SessionMeta = { projectId, sessionSlug, label: normalizeLabel(label), favorite };
  const isDefault = updated.label === undefined && !updated.favorite;

  const next = [...entries];
  if (index === -1) {
    // Don't persist a no-op entry for a session that's never had one --
    // keeps the file from growing an entry per session ever opened.
    if (!isDefault) next.push(updated);
  } else if (isDefault) {
    // Clearing back to the default: remove the entry entirely rather than
    // keeping a dead record around.
    next.splice(index, 1);
  } else {
    next[index] = updated;
  }
  await saveSessionMeta(filePath, next);
  return updated;
}
