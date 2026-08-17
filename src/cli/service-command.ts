import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFileCb);

export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

function defaultExec(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args);
}

export class ServiceCommandError extends Error {}

const SERVICE_NAME = "tmux-web";

function unitDir(homeDir: string): string {
  return join(homeDir, ".config", "systemd", "user");
}

function unitFilePath(homeDir: string): string {
  return join(unitDir(homeDir), `${SERVICE_NAME}.service`);
}

// Resolved relative to this module's own location, so it points at the
// right bin/tmuxweb.ts whether tmux-web is a local dev clone or a global
// `npm install -g` install -- no dependence on argv or PATH.
export function resolveBinPath(): string {
  return fileURLToPath(new URL("../../bin/tmuxweb.ts", import.meta.url));
}

function buildUnit(execPathNode: string, binPath: string): string {
  return `[Unit]
Description=tmux-web - browser GUI for tmux sessions
After=network.target

[Service]
Type=simple
ExecStart=${execPathNode} --experimental-strip-types ${binPath} start
Restart=on-failure
RestartSec=2

# ProtectSystem=strict was removed: as a systemd --user unit (non-root),
# enforcing it requires an unprivileged user namespace where every UID
# other than the service's own (including root) collapses to
# nobody:nogroup. That broke ownership checks on root-owned files like
# /etc/ssh/ssh_config.d/*.conf, causing "Bad owner or permissions" errors
# for any ssh-based command (ssh, git over ssh, scp) run inside tmux
# sessions spawned by this service.
NoNewPrivileges=true

# KillMode=process: the tmux server daemonizes into this unit's cgroup (tmux
# only escapes its parent process, never its cgroup), so with the default
# control-group kill mode every restart -- including the one "tmuxweb upgrade"
# does -- SIGTERMs the tmux server itself and destroys every session the user
# had open. Kill only the node process; tmux sessions must outlive tmux-web
# restarts, stops, and crashes.
KillMode=process

[Install]
WantedBy=default.target
`;
}

export interface ServiceCommandDeps {
  platform?: string;
  exec?: ExecFn;
  homeDir?: string;
  execPathNode?: string;
  binPath?: string;
  username?: string;
}

interface ResolvedDeps {
  platform: string;
  exec: ExecFn;
  homeDir: string;
  execPathNode: string;
  binPath: string;
  username: string;
}

function resolveDeps(deps: ServiceCommandDeps): ResolvedDeps {
  return {
    platform: deps.platform ?? process.platform,
    exec: deps.exec ?? defaultExec,
    homeDir: deps.homeDir ?? homedir(),
    execPathNode: deps.execPathNode ?? process.execPath,
    binPath: deps.binPath ?? resolveBinPath(),
    username: deps.username ?? userInfo().username,
  };
}

function messageOf(error: unknown): string {
  const stderr = (error as { stderr?: string })?.stderr;
  if (stderr) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}

async function run(exec: ExecFn, file: string, args: string[]): Promise<void> {
  try {
    await exec(file, args);
  } catch (error) {
    throw new ServiceCommandError(messageOf(error));
  }
}

export async function installService(deps: ServiceCommandDeps = {}): Promise<void> {
  const { platform, exec, homeDir, execPathNode, binPath, username } = resolveDeps(deps);

  if (platform !== "linux") {
    throw new ServiceCommandError(
      `tmuxweb service install only supports Linux (systemd --user). Detected: ${platform}`,
    );
  }

  try {
    await exec("systemctl", ["--version"]);
  } catch {
    throw new ServiceCommandError(
      "systemctl not found. tmuxweb service install requires a systemd-based Linux distro.",
    );
  }

  const unit = buildUnit(execPathNode, binPath);
  await mkdir(unitDir(homeDir), { recursive: true });
  await writeFile(unitFilePath(homeDir), unit);
  console.log(`Wrote ${unitFilePath(homeDir)}`);

  await run(exec, "systemctl", ["--user", "daemon-reload"]);
  await run(exec, "systemctl", ["--user", "enable", "--now", SERVICE_NAME]);

  try {
    await run(exec, "loginctl", ["enable-linger", username]);
    console.log(`Linger enabled for ${username} -- tmux-web will keep running after logout/reboot.`);
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

  console.log("");
  console.log("tmux-web is running as a systemd --user service.");
  console.log(`  Logs:    journalctl --user -u ${SERVICE_NAME} -f`);
  console.log(`  Restart: systemctl --user restart ${SERVICE_NAME}`);
  console.log(`  Stop:    systemctl --user disable --now ${SERVICE_NAME}`);
}

export async function uninstallService(deps: ServiceCommandDeps = {}): Promise<void> {
  const { exec, homeDir } = resolveDeps(deps);
  await run(exec, "systemctl", ["--user", "disable", "--now", SERVICE_NAME]);
  await rm(unitFilePath(homeDir), { force: true });
  await run(exec, "systemctl", ["--user", "daemon-reload"]);
  console.log(`Removed ${unitFilePath(homeDir)} and disabled the ${SERVICE_NAME} service.`);
}

// `systemctl status` exits non-zero for some non-failure states (e.g. a
// service that's enabled but currently inactive); only treat it as a real
// failure when there's no status text to show at all.
export async function statusService(deps: ServiceCommandDeps = {}): Promise<void> {
  const { exec } = resolveDeps(deps);
  try {
    const { stdout } = await exec("systemctl", ["--user", "status", SERVICE_NAME, "--no-pager"]);
    console.log(stdout);
  } catch (error) {
    const stdout = (error as { stdout?: string })?.stdout;
    if (stdout) {
      console.log(stdout);
      return;
    }
    throw new ServiceCommandError(messageOf(error));
  }
}

export async function runServiceCommand(args: string[], deps: ServiceCommandDeps = {}): Promise<void> {
  const [subcommand] = args;
  switch (subcommand) {
    case "install":
      return installService(deps);
    case "uninstall":
      return uninstallService(deps);
    case "status":
      return statusService(deps);
    default:
      throw new ServiceCommandError("Usage: tmuxweb service <install|uninstall|status>");
  }
}
