import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

// EMB-220: templates are per-project (base branch/env config are project-
// specific, per the ticket), stored as one flat JSON file for every
// project's templates -- same "single JSON array on disk" shape as
// projects.ts, just filtered by projectId in memory rather than one file
// per project, matching this app's existing convention of not fragmenting
// small JSON stores across many files.
export interface SessionTemplate {
  id: string;
  projectId: string;
  name: string;
  // Sent as `tmux send-keys` to the new session's first window right after
  // creation (see project-sessions.ts's createProjectSession) -- e.g. "npm
  // install && npm run dev". Optional: a template can exist purely to
  // remember a name/preset with no startup action.
  startupCommand?: string;
  createdAt: string;
}

export class TemplateValidationError extends Error {}
export class TemplateNotFoundError extends Error {}

export async function loadTemplates(filePath: string): Promise<SessionTemplate[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionTemplate[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
}

export async function saveTemplates(filePath: string, templates: SessionTemplate[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  // Write-then-rename keeps concurrent readers from ever seeing a
  // half-written file -- same pattern as projects.ts's saveProjects.
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, JSON.stringify(templates, null, 2));
  await rename(tempPath, filePath);
}

export async function listProjectTemplates(filePath: string, projectId: string): Promise<SessionTemplate[]> {
  return (await loadTemplates(filePath)).filter((template) => template.projectId === projectId);
}

function normalizeStartupCommand(startupCommand: string | undefined): string | undefined {
  const trimmed = startupCommand?.trim();
  return trimmed ? trimmed : undefined;
}

export type RandomIdFn = () => string;

export async function createTemplate(
  filePath: string,
  projectId: string,
  name: string,
  startupCommand: string | undefined,
  randomId: RandomIdFn = randomUUID,
): Promise<SessionTemplate> {
  if (!name.trim()) {
    throw new TemplateValidationError("Template name must not be empty");
  }
  const templates = await loadTemplates(filePath);
  const template: SessionTemplate = {
    id: randomId(),
    projectId,
    name,
    startupCommand: normalizeStartupCommand(startupCommand),
    createdAt: new Date().toISOString(),
  };
  await saveTemplates(filePath, [...templates, template]);
  return template;
}

export async function updateTemplate(
  filePath: string,
  projectId: string,
  templateId: string,
  name: string,
  startupCommand: string | undefined,
): Promise<SessionTemplate> {
  if (!name.trim()) {
    throw new TemplateValidationError("Template name must not be empty");
  }
  const templates = await loadTemplates(filePath);
  const index = templates.findIndex((template) => template.id === templateId && template.projectId === projectId);
  if (index === -1) {
    throw new TemplateNotFoundError(`Template not found: ${templateId}`);
  }
  const updated: SessionTemplate = {
    ...templates[index],
    name,
    startupCommand: normalizeStartupCommand(startupCommand),
  };
  const next = [...templates];
  next[index] = updated;
  await saveTemplates(filePath, next);
  return updated;
}

export async function deleteTemplate(filePath: string, projectId: string, templateId: string): Promise<void> {
  const templates = await loadTemplates(filePath);
  await saveTemplates(
    filePath,
    templates.filter((template) => !(template.id === templateId && template.projectId === projectId)),
  );
}
