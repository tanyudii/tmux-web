import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export interface User {
  username: string;
  passwordHash: string;
  createdAt: string;
}

export class UserValidationError extends Error {}

const SCRYPT_KEY_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPasswordHash(password: string, passwordHash: string): boolean {
  const [saltHex, hashHex] = passwordHash.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), SCRYPT_KEY_LENGTH);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// Computed once at module load so verifyPassword can always pay the same
// scrypt cost whether or not `username` exists -- otherwise a nonexistent
// username short-circuits before hashing and leaks account existence via
// response timing.
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(16).toString("hex"));

export async function loadUsers(filePath: string): Promise<User[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as User[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
}

// Mirrors config.ts's writeConfig: 0o600/0o700 (not projects.ts's default
// mode) since this file holds password hashes.
export async function saveUsers(filePath: string, users: User[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, JSON.stringify(users, null, 2), { mode: 0o600 });
  await rename(tempPath, filePath);
}

export async function createUser(filePath: string, username: string, password: string): Promise<User> {
  const trimmed = username.trim();
  if (!trimmed) {
    throw new UserValidationError("Username must not be empty");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const users = await loadUsers(filePath);
  if (users.some((user) => user.username === trimmed)) {
    throw new UserValidationError(`User already exists: ${trimmed}`);
  }

  const user: User = {
    username: trimmed,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  await saveUsers(filePath, [...users, user]);
  return user;
}

export async function removeUser(filePath: string, username: string): Promise<void> {
  const users = await loadUsers(filePath);
  await saveUsers(filePath, users.filter((user) => user.username !== username));
}

export async function verifyPassword(filePath: string, username: string, password: string): Promise<boolean> {
  const users = await loadUsers(filePath);
  const user = users.find((candidate) => candidate.username === username);
  const valid = verifyPasswordHash(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  return Boolean(user) && valid;
}
