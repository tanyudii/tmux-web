import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes, createHash } from "node:crypto";

// Not named "sessions.ts"/"Session" -- this codebase already uses "session"
// pervasively for tmux sessions (ProjectSession, session-naming.ts, etc.);
// reusing that word here for login tokens would collide.
export interface AuthToken {
  tokenHash: string;
  username: string;
  createdAt: string;
}

// Tokens are 32 random bytes (>= config.ts's old static-token entropy), so
// storage/lookup is by exact SHA-256 hash match -- a direct map/array
// lookup, not a per-user timingSafeEqual scan. No timing side-channel: an
// attacker who doesn't already hold the raw token cannot produce a matching
// hash regardless of how the lookup is implemented.
function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

// Bounded token lifetime: a leaked or forgotten browser token (localStorage,
// shared machine, synced device) stops working on its own; re-login is cheap.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function loadAuthTokens(filePath: string): Promise<AuthToken[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuthToken[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
}

export async function saveAuthTokens(filePath: string, tokens: AuthToken[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  await rename(tempPath, filePath);
}

export async function issueAuthToken(filePath: string, username: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokens = await loadAuthTokens(filePath);
  const token: AuthToken = { tokenHash: hashToken(rawToken), username, createdAt: new Date().toISOString() };
  await saveAuthTokens(filePath, [...tokens, token]);
  return rawToken;
}

export async function resolveAuthToken(filePath: string, rawToken: string | undefined): Promise<string | undefined> {
  if (!rawToken) return undefined;
  const tokens = await loadAuthTokens(filePath);
  const match = tokens.find((token) => token.tokenHash === hashToken(rawToken));
  if (!match) return undefined;
  if (Date.now() - Date.parse(match.createdAt) > TOKEN_TTL_MS) return undefined;
  return match.username;
}

export async function revokeAuthToken(filePath: string, rawToken: string): Promise<void> {
  const hash = hashToken(rawToken);
  const tokens = await loadAuthTokens(filePath);
  await saveAuthTokens(filePath, tokens.filter((token) => token.tokenHash !== hash));
}

// Called when a user is removed: their already-issued tokens must stop
// working immediately, not keep granting access until their natural expiry.
export async function revokeAllTokensForUser(filePath: string, username: string): Promise<void> {
  const tokens = await loadAuthTokens(filePath);
  await saveAuthTokens(filePath, tokens.filter((token) => token.username !== username));
}
