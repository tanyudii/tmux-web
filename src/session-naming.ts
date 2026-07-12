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
