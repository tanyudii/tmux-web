import { homedir } from "node:os";
import { join } from "node:path";

// Where tmux-web's own code lives when installed via `tmuxweb upgrade`
// (a git clone kept outside any node_modules directory -- see upgrade.ts).
// Deliberately distinct from ~/.tmux-web (config.ts's defaultConfigDir),
// which holds runtime data only: token, port, host, projects, worktrees.
export function defaultAppDir(): string {
  return join(homedir(), ".local", "share", "tmux-web");
}
