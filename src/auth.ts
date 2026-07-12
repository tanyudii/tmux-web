import { timingSafeEqual } from "node:crypto";

const BEARER_PATTERN = /^Bearer\s+(.+?)\s*$/i;

export function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const match = BEARER_PATTERN.exec(authHeader);
  return match ? match[1] : undefined;
}

export function extractQueryToken(urlPath: string): string | undefined {
  try {
    const url = new URL(urlPath, "http://localhost");
    return url.searchParams.get("token") ?? undefined;
  } catch {
    return undefined;
  }
}

export function verifyToken(provided: string | undefined, expected: string): boolean {
  // Fail closed: a misconfigured server (empty expected token) must never
  // grant access, no matter what the client sends.
  if (!expected || !provided) return false;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}
