// Client for the `/ws` terminal socket -- ports TerminalSocket.kt /
// KtorTerminalSocket.kt. Query params and wire format mirror src/main.ts's
// `/ws` upgrade handler and src/pty-bridge.ts's ClientMessage exactly:
// token as `?token=` (not a header -- browsers can't set custom headers on
// a WebSocket handshake), raw text frames server->client with no envelope,
// `{type:"input"|"resize"|"scroll"}` JSON client->server.
export type ScrollDirection = "up" | "down";

type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "scroll"; direction: ScrollDirection; lines: number };

export interface TerminalSocketConfig {
  baseUrl: string;
  token: string;
  // Injectable for tests, mirroring the SpawnPtyFn/ScrollPaneFn pattern in
  // src/pty-bridge.ts -- defaults to the real global WebSocket.
  WebSocketImpl?: typeof WebSocket;
}

/**
 * Mirrors SESSION_ENDED_CLOSE_CODE in src/pty-bridge.ts. Duplicated rather than
 * imported because the server and this PWA are separate builds with no shared
 * module -- the value is part of the wire contract between them, so it is
 * pinned here with a pointer back to its origin. Changing one without the
 * other silently restores the reconnect-forever bug.
 */
export const SESSION_ENDED_CLOSE_CODE = 4001;

type TerminalSocketEventMap = {
  open: [];
  data: [string];
  // Carries the WebSocket close code. Without it every close looks identical
  // to the store, so it could not tell "the tmux session is gone" (code
  // SESSION_ENDED_CLOSE_CODE from src/pty-bridge.ts) from an ordinary drop,
  // and retried forever after the last window was closed.
  close: [number];
};

type Listener<Args extends unknown[]> = (...args: Args) => void;

function buildWsUrl(baseUrl: string, token: string, sessionFullName: string, pane: number): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.searchParams.set("session", sessionFullName);
  url.searchParams.set("token", token);
  if (pane !== 0) url.searchParams.set("pane", String(pane));
  return url.toString();
}

export function createTerminalSocket(config: TerminalSocketConfig) {
  const WebSocketCtor = config.WebSocketImpl ?? WebSocket;
  const listeners: { [K in keyof TerminalSocketEventMap]: Set<Listener<TerminalSocketEventMap[K]>> } = {
    open: new Set(),
    data: new Set(),
    close: new Set(),
  };

  let ws: WebSocket | null = null;
  // Messages sent before the socket finishes opening are queued and
  // flushed on open, rather than silently dropped -- see CLAUDE.md's
  // "resize-sent-before-WebSocket-open" bug. Resize is idempotent (only
  // the final size matters), so a new pending resize replaces the
  // previous one instead of piling up; input/scroll queue in order.
  let pendingResizeIndex: number | null = null;
  let queue: ClientMessage[] = [];

  function emit<K extends keyof TerminalSocketEventMap>(event: K, ...args: TerminalSocketEventMap[K]): void {
    for (const listener of listeners[event]) listener(...args);
  }

  function sendOrQueue(message: ClientMessage): void {
    if (ws && ws.readyState === WebSocketCtor.OPEN) {
      ws.send(JSON.stringify(message));
      return;
    }
    if (message.type === "resize") {
      if (pendingResizeIndex !== null) {
        queue[pendingResizeIndex] = message;
      } else {
        pendingResizeIndex = queue.length;
        queue.push(message);
      }
      return;
    }
    queue.push(message);
  }

  function flushQueue(): void {
    const pending = queue;
    queue = [];
    pendingResizeIndex = null;
    for (const message of pending) ws?.send(JSON.stringify(message));
  }

  return {
    on<K extends keyof TerminalSocketEventMap>(event: K, listener: Listener<TerminalSocketEventMap[K]>): void {
      listeners[event].add(listener);
    },

    off<K extends keyof TerminalSocketEventMap>(event: K, listener: Listener<TerminalSocketEventMap[K]>): void {
      listeners[event].delete(listener);
    },

    connect(sessionFullName: string, pane = 0): void {
      // Tear the previous socket down first. Without this, a reconnect
      // (terminalStore's backoff loop, or a manual Retry) left the old
      // WebSocket open: the server spawns one `tmux attach-session` per
      // socket, so two live PTYs ended up attached to the same session,
      // BOTH streaming output into the same xterm instance -- duplicated /
      // interleaved text appearing out of nowhere. tmux also sizes a
      // session to its smallest attached client, so the stale client kept
      // forcing redraws at the wrong dimensions.
      //
      // The old socket's handlers are detached before closing so its
      // `onclose` cannot fire `emit("close")` and trip the reconnect logic
      // for a socket we are deliberately replacing.
      const previous = ws;
      if (previous) {
        previous.onopen = null;
        previous.onmessage = null;
        previous.onclose = null;
        previous.close();
      }

      const socket = new WebSocketCtor(buildWsUrl(config.baseUrl, config.token, sessionFullName, pane));
      ws = socket;
      socket.onopen = () => {
        flushQueue();
        emit("open");
      };
      socket.onmessage = (event: MessageEvent) => {
        emit("data", typeof event.data === "string" ? event.data : String(event.data));
      };
      // `event` is optional only to tolerate test doubles that call onclose()
      // bare; a real browser always supplies a CloseEvent. 1006 (abnormal
      // closure) is the honest default -- it is what the browser itself reports
      // for a connection that dropped without a close frame, and it is not the
      // session-ended code, so it correctly still triggers a reconnect.
      socket.onclose = (event?: CloseEvent) => {
        // A socket that has already been replaced must not report a close
        // -- only the current one drives reconnect state.
        if (ws === socket) emit("close", event?.code ?? 1006);
      };
    },

    sendInput(data: string): void {
      sendOrQueue({ type: "input", data });
    },

    sendResize(cols: number, rows: number): void {
      sendOrQueue({ type: "resize", cols, rows });
    },

    sendScroll(direction: ScrollDirection, lines: number): void {
      sendOrQueue({ type: "scroll", direction, lines });
    },

    close(): void {
      ws?.close();
      ws = null;
    },
  };
}

export type TerminalSocket = ReturnType<typeof createTerminalSocket>;
