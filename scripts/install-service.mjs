// Installs tmux-web as a systemd --user service so it keeps running in
// the background, restarts on crash, and (with linger enabled) survives
// reboots and logout. Run via `npm run install-service`. See README
// "Running as a service" for the manual equivalent of what this does.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const envFile = join(rootDir, ".env");
const mainFile = join(rootDir, "src", "main.ts");
const unitDir = join(homedir(), ".config", "systemd", "user");
const unitFile = join(unitDir, "tmux-web.service");
const username = userInfo().username;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

if (process.platform !== "linux") {
  fail(`install-service only supports Linux (systemd --user). Detected: ${process.platform}`);
}

try {
  execFileSync("systemctl", ["--version"], { stdio: "ignore" });
} catch {
  fail("systemctl not found. install-service requires a systemd-based Linux distro.");
}

if (!existsSync(envFile)) {
  fail(
    [
      `No .env file found at ${envFile}. Create one first:`,
      "  cp .env.example .env",
      "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      "then paste the generated token into TMUX_WEB_TOKEN in .env.",
    ].join("\n"),
  );
}

// Use the exact node binary running this script (process.execPath) rather
// than `/usr/bin/env node`: systemd --user services don't source shell rc
// files, so a version manager's shims (nvm, mise, asdf, ...) are invisible
// to them and a plain `node` ExecStart would fail with "command not found".
const unit = `[Unit]
Description=tmux-web - browser GUI for tmux sessions
After=network.target

[Service]
Type=simple
WorkingDirectory=${rootDir}
EnvironmentFile=${envFile}
ExecStart=${process.execPath} --experimental-strip-types ${mainFile}
Restart=on-failure
RestartSec=2

# Defense in depth: filesystem access is scoped to this service, and the
# service still runs as the systemd --user account (not root). /tmp must
# stay writable because that's where tmux keeps its server socket
# (/tmp/tmux-$UID/); without it the tmux server can't even start.
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${rootDir} /tmp

[Install]
WantedBy=default.target
`;

mkdirSync(unitDir, { recursive: true });
writeFileSync(unitFile, unit);
console.log(`Wrote ${unitFile}`);

run("systemctl", ["--user", "daemon-reload"]);
run("systemctl", ["--user", "enable", "--now", "tmux-web"]);

try {
  run("loginctl", ["enable-linger", username]);
  console.log(`Linger enabled for ${username} - tmux-web will keep running after logout/reboot.`);
} catch {
  console.warn(
    [
      "",
      `Could not enable linger for ${username} (this needs admin privileges on most distros).`,
      "Without it, the service stops as soon as you log out. Run this once, manually, to fix that:",
      `  sudo loginctl enable-linger ${username}`,
    ].join("\n"),
  );
}

try {
  run("systemctl", ["--user", "status", "tmux-web", "--no-pager"]);
} catch {
  // `systemctl status` exits non-zero for some non-failure states; the
  // commands below are what actually matter for troubleshooting.
}

console.log("");
console.log("tmux-web is running as a systemd --user service.");
console.log("  Logs:    journalctl --user -u tmux-web -f");
console.log("  Restart: systemctl --user restart tmux-web");
console.log("  Stop:    systemctl --user disable --now tmux-web");
