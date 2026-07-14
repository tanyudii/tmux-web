import { defaultConfigDir, generateToken, readConfig, writeConfig } from "../config.ts";

export async function runGenerate(_args: string[], configDir: string = defaultConfigDir()): Promise<void> {
  const config = await readConfig(configDir);
  const updated = { ...config, token: generateToken() };
  await writeConfig(updated, configDir);

  console.log(`token: ${updated.token}`);
  console.log("Restart tmux-web (or `systemctl --user restart tmux-web`) for the new token to take effect.");
}
