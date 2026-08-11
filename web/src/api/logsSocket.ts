// Client for the `/ws/logs` socket -- ports LogsSocket.kt / KtorLogsSocket.kt.
// Read-only: src/log-stream.ts's attachLogsToSocket never reads from the
// socket, so unlike terminalSocket.ts there is no send() of any kind, and
// the server only ever sends text frames (no binary PTY output here).
export interface LogsSocketConfig {
  baseUrl: string;
  token: string;
  // Injectable for tests, mirroring terminalSocket.ts's WebSocketImpl.
  WebSocketImpl?: typeof WebSocket;
}

type LogsSocketEventMap = {
  open: [];
  data: [string];
  close: [];
};

type Listener<Args extends unknown[]> = (...args: Args) => void;

function buildWsUrl(baseUrl: string, token: string, projectId: string, sessionSlug: string, service: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/logs";
  url.search = "";
  url.searchParams.set("project", projectId);
  url.searchParams.set("session", sessionSlug);
  url.searchParams.set("service", service);
  url.searchParams.set("token", token);
  return url.toString();
}

export function createLogsSocket(config: LogsSocketConfig) {
  const WebSocketCtor = config.WebSocketImpl ?? WebSocket;
  const listeners: { [K in keyof LogsSocketEventMap]: Set<Listener<LogsSocketEventMap[K]>> } = {
    open: new Set(),
    data: new Set(),
    close: new Set(),
  };

  let ws: WebSocket | null = null;

  function emit<K extends keyof LogsSocketEventMap>(event: K, ...args: LogsSocketEventMap[K]): void {
    for (const listener of listeners[event]) listener(...args);
  }

  return {
    on<K extends keyof LogsSocketEventMap>(event: K, listener: Listener<LogsSocketEventMap[K]>): void {
      listeners[event].add(listener);
    },

    off<K extends keyof LogsSocketEventMap>(event: K, listener: Listener<LogsSocketEventMap[K]>): void {
      listeners[event].delete(listener);
    },

    connect(projectId: string, sessionSlug: string, service: string): void {
      const socket = new WebSocketCtor(buildWsUrl(config.baseUrl, config.token, projectId, sessionSlug, service));
      ws = socket;
      socket.onopen = () => emit("open");
      socket.onmessage = (event: MessageEvent) => {
        emit("data", typeof event.data === "string" ? event.data : String(event.data));
      };
      socket.onclose = () => emit("close");
    },

    close(): void {
      ws?.close();
      ws = null;
    },
  };
}

export type LogsSocket = ReturnType<typeof createLogsSocket>;
