import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

export interface Config {
  token: string;
  port: number;
  host: string;
}

export class ConfigError extends Error {}
export class ConfigNotFoundError extends ConfigError {}

const MIN_TOKEN_LENGTH = 16;
const DEFAULT_PORT = 5309;
const DEFAULT_HOST = "127.0.0.1";
const CONFIG_FILE_NAME = "config.json";

export function defaultConfigDir(): string {
  return join(homedir(), ".tmux-web");
}

export function configFilePath(configDir: string = defaultConfigDir()): string {
  return join(configDir, CONFIG_FILE_NAME);
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function validateToken(token: unknown): string {
  if (typeof token !== "string" || token.length < MIN_TOKEN_LENGTH) {
    throw new ConfigError(`token must be a string of at least ${MIN_TOKEN_LENGTH} characters`);
  }
  return token;
}

export function validatePort(port: unknown): number {
  const value = typeof port === "number" ? port : Number.NaN;
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new ConfigError(`Invalid port: ${String(port)}`);
  }
  return value;
}

export function validateHost(host: unknown): string {
  if (typeof host !== "string" || host.trim().length === 0) {
    throw new ConfigError(`Invalid host: ${String(host)}`);
  }
  return host;
}

function parseConfigJson(raw: unknown): Config {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    token: validateToken(obj.token),
    port: validatePort(obj.port ?? DEFAULT_PORT),
    host: validateHost(obj.host ?? DEFAULT_HOST),
  };
}

export function createDefaultConfig(): Config {
  return { token: generateToken(), port: DEFAULT_PORT, host: DEFAULT_HOST };
}

export async function configExists(configDir: string = defaultConfigDir()): Promise<boolean> {
  try {
    await readFile(configFilePath(configDir), "utf-8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw error;
  }
}

export async function readConfig(configDir: string = defaultConfigDir()): Promise<Config> {
  const filePath = configFilePath(configDir);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new ConfigNotFoundError(`No config found at ${filePath}. Run \`tmuxweb init\` first.`);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`Config at ${filePath} is not valid JSON`);
  }

  return parseConfigJson(parsed);
}

// Write-then-rename keeps concurrent readers from ever seeing a
// half-written file (same pattern as projects.ts). Mode 0o600 keeps the
// bearer token unreadable by other local accounts on a shared Linux host --
// the default mode (0o644 minus umask) would leave it world-readable.
export async function writeConfig(config: Config, configDir: string = defaultConfigDir()): Promise<void> {
  const filePath = configFilePath(configDir);
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  await rename(tempPath, filePath);
}
