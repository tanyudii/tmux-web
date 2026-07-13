import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

function defaultExec(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args);
}

export class DockerComposeError extends Error {}

export interface ComposeContext {
  // Same composite name used for the session's tmux session (see
  // session-naming.ts) -- reusing it scopes each session's containers,
  // networks, and volumes to that session alone.
  projectName: string;
  composeFile: string;
  worktreePath: string;
}

function stderrOf(error: unknown): string {
  return (error as { stderr?: string })?.stderr ?? "";
}

function messageOf(error: unknown): string {
  const stderr = stderrOf(error);
  if (stderr) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}

function baseArgs(ctx: ComposeContext): string[] {
  return [
    "compose",
    "-p", ctx.projectName,
    "-f", ctx.composeFile,
    "--project-directory", ctx.worktreePath,
  ];
}

export async function composeUp(ctx: ComposeContext, exec: ExecFn = defaultExec): Promise<void> {
  try {
    await exec("docker", [...baseArgs(ctx), "up", "-d", "--build"]);
  } catch (error) {
    throw new DockerComposeError(messageOf(error));
  }
}

export async function composeDown(ctx: ComposeContext, exec: ExecFn = defaultExec): Promise<void> {
  try {
    await exec("docker", [...baseArgs(ctx), "down", "-v"]);
  } catch (error) {
    throw new DockerComposeError(messageOf(error));
  }
}

export interface ComposeServiceStatus {
  service: string;
  state: string;
  health?: string;
}

// `docker compose ps --format json` prints one JSON object per line (not a
// single JSON array), so each non-empty line is parsed independently.
export async function composePs(
  ctx: ComposeContext,
  exec: ExecFn = defaultExec,
): Promise<ComposeServiceStatus[]> {
  let stdout: string;
  try {
    ({ stdout } = await exec("docker", [...baseArgs(ctx), "ps", "--format", "json"]));
  } catch (error) {
    throw new DockerComposeError(messageOf(error));
  }

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = JSON.parse(line) as { Service?: string; State?: string; Health?: string };
      return {
        service: parsed.Service ?? "",
        state: parsed.State ?? "",
        health: parsed.Health || undefined,
      };
    });
}

const LOG_TAIL_LINES = 200;

// Args for `docker compose logs --follow` -- used by log-stream.ts, which
// spawns this directly (not via ExecFn) since it needs a live stream rather
// than a single resolved stdout string.
export function composeLogsArgs(ctx: ComposeContext, service?: string): string[] {
  const args = [...baseArgs(ctx), "logs", "--follow", `--tail=${LOG_TAIL_LINES}`];
  if (service) args.push(service);
  return args;
}

const NO_PORT_PATTERN = /no port|not found/i;

// Resolves the host port docker published for <service>:<containerPort> in
// this session's isolated compose project. Returns null when the service
// exists but doesn't publish that port (not every service needs to be
// "openable" -- e.g. a database has no browser-facing port).
export async function composePort(
  ctx: ComposeContext,
  service: string,
  containerPort: number,
  exec: ExecFn = defaultExec,
): Promise<number | null> {
  let stdout: string;
  try {
    ({ stdout } = await exec("docker", [...baseArgs(ctx), "port", service, String(containerPort)]));
  } catch (error) {
    if (NO_PORT_PATTERN.test(stderrOf(error))) return null;
    throw new DockerComposeError(messageOf(error));
  }

  const match = stdout.trim().match(/:(\d+)\s*$/m);
  return match ? Number.parseInt(match[1], 10) : null;
}
