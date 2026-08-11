// Ports kmp/composeApp/.../domain/ServerUrl.kt (itself a port of
// ConnectionSettingsView.swift's `URL(string:) ... scheme != nil && host !=
// nil` check). Normalizes down to `scheme://host[:port]` -- any path suffix
// is dropped, since every endpoint is built by appending a path to this
// base (see api/client.ts's buildUrl).
const SERVER_URL_PATTERN = /^(https?):\/\/([^/\s]+)(\/.*)?$/;

export function parseServerUrl(text: string): string | null {
  const match = SERVER_URL_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, scheme, hostAndPort] = match;
  if (!hostAndPort) return null;
  return `${scheme}://${hostAndPort}`;
}
