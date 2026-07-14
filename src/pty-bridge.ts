import * as pty from "node-pty";
import { scrollPane, cancelCopyMode, type ScrollDirection } from "./tmux.ts";

export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "scroll"; direction: ScrollDirection; lines: number };

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

  if (
    msg.type === "scroll" &&
    (msg.direction === "up" || msg.direction === "down") &&
    Number.isInteger(msg.lines) &&
    (msg.lines as number) > 0
  ) {
    return { type: "scroll", direction: msg.direction, lines: msg.lines as number };
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

export type ScrollPaneFn = (sessionName: string, direction: ScrollDirection, lines: number) => Promise<void>;
export type CancelCopyModeFn = (sessionName: string) => Promise<void>;

function defaultScrollPane(sessionName: string, direction: ScrollDirection, lines: number): Promise<void> {
  return scrollPane(sessionName, direction, lines);
}

function defaultCancelCopyMode(sessionName: string): Promise<void> {
  return cancelCopyMode(sessionName);
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
  scrollPaneFn: ScrollPaneFn = defaultScrollPane,
  cancelCopyModeFn: CancelCopyModeFn = defaultCancelCopyMode,
): PtyLike {
  const term = spawnPty(sessionName, cols, rows);

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  term.onExit(() => {
    if (ws.readyState === ws.OPEN) ws.close();
  });

  // tmux CLI calls (copy-mode entry/exit, send-keys) are spawned as separate
  // subprocesses and must not race each other -- chaining them onto one
  // queue keeps e.g. a scroll-up's `copy-mode` landing before a same-tick
  // cancel's `send-keys -X cancel`, regardless of subprocess scheduling.
  let scrollQueue: Promise<void> = Promise.resolve();
  // Best-effort, optimistic tracking of "the last thing we told tmux was a
  // scroll-up" -- used only to decide whether the next keystroke needs a
  // cancel first, so a stray false positive just costs one harmless no-op
  // cancel call rather than a wrong read of real tmux state on every key.
  let possiblyInCopyMode = false;
  // While a cancel is in flight, EVERY input message must wait for it --
  // not just the one that triggered it. A user typing fast sends one "input"
  // WS message per keystroke; only gating the first keystroke on the cancel
  // and writing the rest immediately let later keystrokes race ahead of the
  // still-pending cancel and land while tmux was still in copy-mode, where
  // its keytable swallows them instead of forwarding to the shell.
  let cancelInFlight: Promise<void> | null = null;

  ws.on("message", (raw) => {
    const text = typeof raw === "string" ? raw : String(raw);
    const message = parseClientMessage(text);
    if (!message) return;

    if (message.type === "resize") {
      term.resize(message.cols, message.rows);
      return;
    }

    if (message.type === "scroll") {
      if (message.direction === "up") possiblyInCopyMode = true;
      scrollQueue = scrollQueue
        .then(() => scrollPaneFn(sessionName, message.direction, message.lines))
        .catch(() => {});
      return;
    }

    // Resuming input after a scroll-up should snap the pane back to live
    // output first, so the keystroke reaches the shell instead of being
    // swallowed by copy-mode's own keytable.
    if (possiblyInCopyMode) {
      possiblyInCopyMode = false;
      const gate = scrollQueue.then(() => cancelCopyModeFn(sessionName)).catch(() => {});
      scrollQueue = gate;
      cancelInFlight = gate;
      gate.then(() => {
        if (cancelInFlight === gate) cancelInFlight = null;
      });
    }

    if (cancelInFlight) {
      cancelInFlight.then(() => term.write(message.data));
      return;
    }

    term.write(message.data);
  });

  ws.on("close", () => {
    // Killing the attach client detaches from tmux (like Ctrl-b d) — the
    // session and everything running inside it keep running server-side.
    term.kill();
  });

  return term;
}
