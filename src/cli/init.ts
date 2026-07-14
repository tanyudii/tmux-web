import { configExists, configFilePath, createDefaultConfig, defaultConfigDir, writeConfig } from "../config.ts";

export async function runInit(args: string[], configDir: string = defaultConfigDir()): Promise<void> {
  const force = args.includes("--force");

  if (!force && (await configExists(configDir))) {
    console.log(`Config already exists at ${configFilePath(configDir)} -- leaving it as-is.`);
    console.log("Run `tmuxweb generate` to rotate the token, or pass --force to overwrite everything.");
    return;
  }

  const config = createDefaultConfig();
  await writeConfig(config, configDir);

  console.log(`Wrote ${configFilePath(configDir)}`);
  console.log("");
  console.log(`token: ${config.token}`);
  console.log(`port:  ${config.port}`);
  console.log(`host:  ${config.host}`);
  console.log("");
  console.log("Next steps:");
  console.log("  tmuxweb                  start the server in the foreground");
  console.log("  tmuxweb service install  or run it as a systemd --user service");
}
