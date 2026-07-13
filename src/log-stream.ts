import { spawn } from "node:child_process";
import { composeLogsArgs, type ComposeContext } from "./docker-compose.ts";

const KILL_TIMEOUT_MS = 3000;

export interface LogProcessLike {
  onData(callback: (data: string) => void): void;
  onExit(callback: () => void): void;
  kill(): void;
}

export type SpawnLogsFn = (ctx: ComposeContext, service: string | undefined) => LogProcessLike;

export function defaultSpawnLogs(ctx: ComposeContext, service: string | undefined): LogProcessLike {
  const child = spawn("docker", composeLogsArgs(ctx, service));

  return {
    onData(callback) {
      child.stdout.on("data", (chunk: Buffer) => callback(chunk.toString("utf-8")));
      child.stderr.on("data", (chunk: Buffer) => callback(chunk.toString("utf-8")));
    },
    onExit(callback) {
      child.on("exit", () => callback());
      // A spawn failure (e.g. the `docker` binary missing or unreadable)
      // only ever emits "error", never "exit" -- without this, the socket
      // would stay open forever with no data and no signal that anything
      // went wrong.
      child.on("error", () => callback());
    },
    kill() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      // `docker compose logs -f` doesn't always exit promptly on SIGTERM
      // (it can be blocked reading from the docker daemon socket) -- force
      // it after a grace period so a slow client disconnect never leaves an
      // orphaned process behind.
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, KILL_TIMEOUT_MS);
      child.once("exit", () => clearTimeout(timer));
    },
  };
}

export interface LogSocketLike {
  readyState: number;
  OPEN: number;
  send(data: string): void;
  close(): void;
  on(event: "close", listener: () => void): void;
}

// Streams `docker compose logs --follow` for a session's environment to a
// WebSocket -- read-only, no input channel back (unlike attachPtyToSocket),
// since a log tail has nothing to write to.
export function attachLogsToSocket(
  ws: LogSocketLike,
  ctx: ComposeContext,
  service: string | undefined,
  spawnLogs: SpawnLogsFn = defaultSpawnLogs,
): LogProcessLike {
  const proc = spawnLogs(ctx, service);

  proc.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  proc.onExit(() => {
    if (ws.readyState === ws.OPEN) ws.close();
  });

  ws.on("close", () => {
    proc.kill();
  });

  return proc;
}
