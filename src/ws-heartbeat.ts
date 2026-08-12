// WebSocket keepalive for every socket this server hands out (`/ws` and
// `/ws/logs`).
//
// Root cause this exists for: neither side of the terminal socket had any
// keepalive at all, and `ws`'s WebSocketServer does NOT ping on its own --
// that is deliberately left to the application. So when the TCP path died
// silently (phone locked, WiFi <-> cellular handover, NAT/WireGuard idle
// timeout, laptop sleep) the connection went *half-open*: both ends still
// believed it was OPEN, no FIN or RST ever arrived, and therefore:
//
//   - server side: `ws.on("close")` in pty-bridge.ts never fired, so
//     `term.kill()` never ran and the `tmux attach-session` process leaked.
//     Those zombie clients matter beyond wasted PIDs -- tmux sizes a window
//     to the SMALLEST attached client, so a leaked 80x24 attach clamps the
//     pane for the live browser too, which looks like a terminal that only
//     redraws its top-left corner.
//   - client side: `onclose` never fired either, so terminalStore stayed in
//     phase "connected" -- no banner, no reconnect backoff, just a frozen
//     screen. (The browser WebSocket API does not expose ping/pong to JS at
//     all, so the client cannot run this half itself; it has its own
//     staleness detection in web/src/domain/staleConnection.ts.)
//
// `terminate()` rather than `close()` on a dead socket is load-bearing:
// `close()` starts a closing handshake and waits for a reply frame that a
// dead peer will never send, so it would hang exactly in the case this is
// meant to clean up. `terminate()` destroys the underlying socket
// immediately, which is what finally fires the `close` event the rest of
// the server is already listening for.

/** Two missed intervals (~60s) before a socket is declared dead. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

export interface HeartbeatSocketLike {
  on(event: "pong" | "close", listener: () => void): void;
  ping(): void;
  terminate(): void;
}

export interface HeartbeatDeps {
  intervalMs?: number;
  // Injectable so tests can drive ticks synchronously instead of waiting
  // real seconds -- same dependency-injection shape as pty-bridge.ts's
  // SpawnPtyFn/ScrollPaneFn.
  setIntervalFn?: (callback: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

const defaultSetInterval = (callback: () => void, ms: number): unknown => {
  const handle = setInterval(callback, ms);
  // Without this a live interval would keep the Node event loop alive on its
  // own; the server should stay up because it is listening, not because a
  // heartbeat timer is pending.
  if (typeof handle === "object" && handle !== null && "unref" in handle) {
    (handle as { unref(): void }).unref();
  }
  return handle;
};

const defaultClearInterval = (handle: unknown): void => {
  clearInterval(handle as ReturnType<typeof setInterval>);
};

/**
 * Pings [ws] on an interval and terminates it if a whole interval passes
 * with no pong. Returns a stop function; the socket's own `close` event
 * also stops it, so callers normally do not need to.
 */
export function attachHeartbeat(ws: HeartbeatSocketLike, deps: HeartbeatDeps = {}): () => void {
  const intervalMs = deps.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  const setIntervalFn = deps.setIntervalFn ?? defaultSetInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? defaultClearInterval;

  // Starts true so a socket is never terminated before it has been given a
  // ping to answer.
  let isAlive = true;
  let stopped = false;

  const handle = setIntervalFn(() => {
    if (stopped) return;
    if (!isAlive) {
      stop();
      ws.terminate();
      return;
    }
    isAlive = false;
    ws.ping();
  }, intervalMs);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearIntervalFn(handle);
  }

  // Browsers answer a protocol-level ping automatically, below JS -- a busy
  // or even fully blocked page still pongs, so a missed pong really does
  // mean the path is gone rather than "the tab is slow".
  ws.on("pong", () => {
    isAlive = true;
  });
  ws.on("close", stop);

  return stop;
}
