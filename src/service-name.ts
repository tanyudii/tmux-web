// Only letters/digits/underscore/dot/hyphen, matching how docker compose
// itself names services -- rejects anything else (e.g. a leading "-") so a
// crafted ?service= query param can never be mistaken for a docker compose
// CLI flag once it reaches composeLogsArgs.
const SERVICE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function sanitizeServiceName(raw: string | null): string | undefined {
  if (!raw) return undefined;
  return SERVICE_NAME_PATTERN.test(raw) ? raw : undefined;
}
