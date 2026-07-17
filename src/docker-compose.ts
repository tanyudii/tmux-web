import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export type ExecFn = (
  file: string,
  args: string[],
  options?: { signal?: AbortSignal },
) => Promise<{ stdout: string; stderr: string }>;

function defaultExec(
  file: string,
  args: string[],
  options?: { signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, { signal: options?.signal });
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

export class ComposeCancelledError extends DockerComposeError {}

export async function composeUp(
  ctx: ComposeContext,
  exec: ExecFn = defaultExec,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await exec("docker", [...baseArgs(ctx), "up", "-d", "--build"], { signal });
  } catch (error) {
    if (signal?.aborted) throw new ComposeCancelledError("Environment setup was cancelled");
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

export class PortCollisionError extends DockerComposeError {}

interface ComposeConfigPort {
  published?: string | number;
}

interface ComposeConfigService {
  ports?: ComposeConfigPort[];
}

interface ComposeConfigJson {
  services?: Record<string, ComposeConfigService>;
}

// Resolves the FIXED host ports this compose file declares (`ports:
// ["3000:3000"]` etc, after full interpolation/merge) -- via the real
// `docker compose config --format json`, not a hand-rolled YAML parser
// (same "shell out to the real tool" pattern as validateComposeFile in
// env-editor.ts). Ephemeral/auto-assigned ports (no host port specified)
// never appear here, so they're correctly excluded from collision checks --
// only a session that pins a specific host port can collide with another.
export async function resolveConfiguredPorts(ctx: ComposeContext, exec: ExecFn = defaultExec): Promise<number[]> {
  let stdout: string;
  try {
    ({ stdout } = await exec("docker", [...baseArgs(ctx), "config", "--format", "json"]));
  } catch (error) {
    throw new DockerComposeError(messageOf(error));
  }

  const parsed = JSON.parse(stdout) as ComposeConfigJson;
  const ports: number[] = [];
  for (const service of Object.values(parsed.services ?? {})) {
    for (const portDef of service.ports ?? []) {
      if (portDef.published === undefined || portDef.published === "") continue;
      const port = typeof portDef.published === "string" ? Number.parseInt(portDef.published, 10) : portDef.published;
      if (Number.isInteger(port)) ports.push(port);
    }
  }
  return ports;
}

// Every host port any OTHER running container currently has bound --
// scoped to the whole docker daemon (not just tmux-web-managed sessions),
// since that's what `docker compose up` will actually collide with,
// regardless of what started the other container.
export async function getHostBoundPorts(exec: ExecFn = defaultExec): Promise<Set<number>> {
  let stdout: string;
  try {
    ({ stdout } = await exec("docker", ["ps", "--format", "{{.Ports}}"]));
  } catch (error) {
    throw new DockerComposeError(messageOf(error));
  }

  const ports = new Set<number>();
  for (const match of stdout.matchAll(/:(\d+)->/g)) {
    ports.add(Number.parseInt(match[1], 10));
  }
  return ports;
}

/**
 * Throws [PortCollisionError] if any host port this compose file pins is
 * already bound by another running container -- called before `composeUp`
 * so the failure is immediate and clearly attributed, instead of surfacing
 * as docker's own opaque "port is already allocated" error after the
 * containers have partially started. EMB-211.
 */
export async function checkPortCollisions(ctx: ComposeContext, exec: ExecFn = defaultExec): Promise<void> {
  const configuredPorts = await resolveConfiguredPorts(ctx, exec);
  if (configuredPorts.length === 0) return;

  const usedPorts = await getHostBoundPorts(exec);
  const collision = configuredPorts.find((port) => usedPorts.has(port));
  if (collision !== undefined) {
    throw new PortCollisionError(
      `Port ${collision} is already in use by another running container -- stop it or change the port in this session's docker-compose.yml`,
    );
  }
}
