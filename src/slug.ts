const DEFAULT_MAX_LENGTH = 50;

// Deliberately excludes '_' (reserved as the separator between projectId and
// sessionSlug in composite tmux session names — see session-naming.ts) so a
// slug can never itself contain that separator.
export function slugifyBranchName(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, maxLength)
    .replace(/[-.]+$/g, "");
}
