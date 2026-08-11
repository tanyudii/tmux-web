import * as pty from "node-pty";
import { scrollPane, cancelCopyMode, listSessions, type ScrollDirection } from "./tmux.ts";

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

/**
 * WebSocket close code telling the client the tmux session itself is gone, so
 * reconnecting is pointless. In the application-private 4000-4999 range, which
 * browsers pass through to `CloseEvent.code` untouched.
 *
 * Without this the client cannot tell "the session ended" from "the network
 * blipped" -- both arrive as a plain close -- so closing the last window (which
 * makes tmux destroy the session) left the UI retrying forever against
 * something that will never come back.
 */
export const SESSION_ENDED_CLOSE_CODE = 4001;

export type SessionExistsFn = (sessionName: string) => Promise<boolean>;

async function defaultSessionExists(sessionName: string): Promise<boolean> {
  const sessions = await listSessions();
  return sessions.some((session) => session.name === sessionName);
}

export interface SocketLike {
  readyState: number;
  OPEN: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
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
  sessionExistsFn: SessionExistsFn = defaultSessionExists,
): PtyLike {
  const term = spawnPty(sessionName, cols, rows);

  // Root-caused live (not guesswork): closing a session's last tmux window
  // kills the whole tmux session, which tears down the `tmux attach-session`
  // process node-pty is wrapping -- its underlying fd becomes invalid before
  // this side's `onExit` callback (itself event-driven/async) has run. A
  // `resize`/`input` WS message that was already in flight (e.g. from a
  // ResizeObserver firing off the WindowTabs layout shift right as the
  // window closed) then calls `term.resize()`/`term.write()` on a dead fd,
  // which throws synchronously (`Error: ioctl(2) failed, EBADF` for resize).
  // Node has no try/catch around this WS `message` handler by default, so an
  // uncaught throw here crashes the ENTIRE server process -- taking down
  // every other user's session too, not just this one. `ptyAlive` short-
  // circuits the common case; the try/catch below is defense-in-depth for
  // the inherent race window where a message lands in the same tick as the
  // fd dying but before `onExit` has fired to flip the flag.
  let ptyAlive = true;

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  term.onExit(() => {
    ptyAlive = false;
    if (ws.readyState !== ws.OPEN) return;
    // The pty ending does NOT by itself mean the session is gone: `Ctrl-B d`
    // detaches, which ends this `tmux attach-session` process while the session
    // keeps running in the background -- and reconnecting after a detach is
    // exactly the right behaviour. So ask tmux which of the two happened rather
    // than assuming, and only tell the client to stop retrying when the session
    // really is no longer listed.
    void sessionExistsFn(sessionName)
      .then((exists) => {
        if (ws.readyState !== ws.OPEN) return;
        if (exists) ws.close();
        else ws.close(SESSION_ENDED_CLOSE_CODE, "session ended");
      })
      // A failed lookup must not leave the socket open forever; fall back to a
      // plain close, which keeps the old reconnect behaviour.
      .catch(() => {
        if (ws.readyState === ws.OPEN) ws.close();
      });
  });

  function safeResize(cols: number, rows: number): void {
    if (!ptyAlive) return;
    try {
      term.resize(cols, rows);
    } catch {
      ptyAlive = false;
    }
  }

  function safeWrite(data: string): void {
    if (!ptyAlive) return;
    try {
      term.write(data);
    } catch {
      ptyAlive = false;
    }
  }

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
      safeResize(message.cols, message.rows);
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
      cancelInFlight.then(() => safeWrite(message.data));
      return;
    }

    safeWrite(message.data);
  });

  ws.on("close", () => {
    // Killing the attach client detaches from tmux (like Ctrl-b d) — the
    // session and everything running inside it keep running server-side.
    term.kill();
  });

  return term;
}
