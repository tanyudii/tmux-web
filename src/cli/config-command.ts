import { ConfigError, defaultConfigDir, readConfig, validateHost, validatePort, writeConfig } from "../config.ts";

function parsePortArg(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new ConfigError(`Invalid port: ${raw}`);
  }
  return validatePort(Number.parseInt(raw, 10));
}

export async function runConfigCommand(args: string[], configDir: string = defaultConfigDir()): Promise<void> {
  const [field, value] = args;

  if (field !== "port" && field !== "host") {
    throw new ConfigError("Usage: tmuxweb config <port|host> <value>");
  }
  if (value === undefined) {
    throw new ConfigError(`Usage: tmuxweb config ${field} <value>`);
  }

  const config = await readConfig(configDir);
  const updated =
    field === "port" ? { ...config, port: parsePortArg(value) } : { ...config, host: validateHost(value) };
  await writeConfig(updated, configDir);

  console.log(`${field}: ${field === "port" ? updated.port : updated.host}`);
  console.log("Restart tmux-web (or `systemctl --user restart tmux-web`) for this to take effect.");
}
