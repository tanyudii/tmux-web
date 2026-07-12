import * as pty from "node-pty";

export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const msg = parsed as Record<string, unknown>;

  if (msg.type === "input" && typeof msg.data === "string") {
    return { type: "input", data: msg.data };
  }

  if (
    msg.type === "resize" &&
    Number.isInteger(msg.cols) &&
    Number.isInteger(msg.rows) &&
    (msg.cols as number) > 0 &&
    (msg.rows as number) > 0
  ) {
    return { type: "resize", cols: msg.cols as number, rows: msg.rows as number };
  }

  return null;
}

export interface PtyLike {
  onData(callback: (data: string) => void): void;
  onExit(callback: () => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type SpawnPtyFn = (sessionName: string, cols: number, rows: number) => PtyLike;

export function defaultSpawnPty(sessionName: string, cols: number, rows: number): PtyLike {
  return pty.spawn("tmux", ["attach-session", "-t", sessionName], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.env.HOME ?? process.cwd(),
    env: process.env as Record<string, string>,
  });
}

export interface SocketLike {
  readyState: number;
  OPEN: number;
  send(data: string): void;
  close(): void;
  on(event: "message" | "close", listener: (data?: unknown) => void): void;
}

export function attachPtyToSocket(
  ws: SocketLike,
  sessionName: string,
  cols: number,
  rows: number,
  spawnPty: SpawnPtyFn = defaultSpawnPty,
): PtyLike {
  const term = spawnPty(sessionName, cols, rows);

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  term.onExit(() => {
    if (ws.readyState === ws.OPEN) ws.close();
  });

  ws.on("message", (raw) => {
    const text = typeof raw === "string" ? raw : String(raw);
    const message = parseClientMessage(text);
    if (!message) return;
    if (message.type === "input") term.write(message.data);
    else term.resize(message.cols, message.rows);
  });

  ws.on("close", () => {
    // Killing the attach client detaches from tmux (like Ctrl-b d) — the
    // session and everything running inside it keep running server-side.
    term.kill();
  });

  return term;
}
