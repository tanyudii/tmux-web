import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  token: string;
  port: number;
  bindHost: string;
  dataDir: string;
}

export class ConfigError extends Error {}

const MIN_TOKEN_LENGTH = 16;
const DEFAULT_PORT = 5309;
const DEFAULT_BIND_HOST = "127.0.0.1";

function defaultDataDir(): string {
  return join(homedir(), ".tmux-web");
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const token = env.TMUX_WEB_TOKEN;
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    throw new ConfigError(
      `TMUX_WEB_TOKEN must be set to a string of at least ${MIN_TOKEN_LENGTH} characters`,
    );
  }

  const portRaw = env.TMUX_WEB_PORT ?? String(DEFAULT_PORT);
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535 || String(port) !== portRaw.trim()) {
    throw new ConfigError(`Invalid TMUX_WEB_PORT: ${portRaw}`);
  }

  const bindHost = env.TMUX_WEB_BIND_HOST ?? DEFAULT_BIND_HOST;
  const dataDir = env.TMUX_WEB_DATA_DIR ?? defaultDataDir();

  return { token, port, bindHost, dataDir };
}
