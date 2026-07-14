// Thin wrapper around `tmuxweb service install` for a local dev clone. Run
// via `npm run install-service`. Once tmux-web is installed globally
// (`npm install -g github:tanyudii/tmux-web#<tag>`), use `tmuxweb service
// install` directly instead -- see README "Running as a service".
import { installService } from "../src/cli/service-command.ts";

installService().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
