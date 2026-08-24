import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

// No auth fields here: since the multi-user rewrite, credentials live in
// users.json (scrypt hashes) and sessions in auth-tokens.json (SHA-256
// token hashes) -- both created via `tmuxweb user add` / POST /api/login,
// not via config.json. A legacy `token` field in an existing config.json
// is simply ignored on read.
export interface Config {
  port: number;
  host: string;
}

export class ConfigError extends Error {}
export class ConfigNotFoundError extends ConfigError {}

const DEFAULT_PORT = 5309;
const DEFAULT_HOST = "127.0.0.1";
const CONFIG_FILE_NAME = "config.json";

export function defaultConfigDir(): string {
  return join(homedir(), ".tmux-web");
}

export function configFilePath(configDir: string = defaultConfigDir()): string {
  return join(configDir, CONFIG_FILE_NAME);
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
    port: validatePort(obj.port ?? DEFAULT_PORT),
    host: validateHost(obj.host ?? DEFAULT_HOST),
  };
}

export function createDefaultConfig(): Config {
  return { port: DEFAULT_PORT, host: DEFAULT_HOST };
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
// config unreadable by other local accounts on a shared Linux host --
// the default mode (0o644 minus umask) would leave it world-readable.
export async function writeConfig(config: Config, configDir: string = defaultConfigDir()): Promise<void> {
  const filePath = configFilePath(configDir);
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  await rename(tempPath, filePath);
}
