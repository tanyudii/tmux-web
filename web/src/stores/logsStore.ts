// Ports presentation/LogsViewModel.kt -- streams /ws/logs output for one
// docker-compose service. Raw chunks in arrival order, not discrete lines:
// docker's stdout/stderr interleaving means a "line" can arrive split
// across chunks, so splitting on "\n" is a render concern for
// LogsDialog.tsx, not a state concern here. Auto-reconnect backoff mirrors
// terminalStore.ts's (same rationale: iOS Safari suspending/closing a
// backgrounded tab's socket applies here too), but unlike terminalStore
// this never surfaces a disconnected *phase* to the UI -- it just keeps
// retrying silently, matching the Kotlin original's LogsUiState (which
// only ever sets errorMessage from a close event's `cause`, something
// web/'s logsSocket.ts's close event carries no payload for, so there's
// nothing to surface here either).
import { createStore } from "solid-js/store";
import type { LogsSocket } from "../api/logsSocket";

const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 10000;

export interface LogsState {
  lines: string[];
  isConnected: boolean;
}

export interface LogsStoreDeps {
  projectId: string;
  sessionSlug: string;
  socket: LogsSocket;
  wait?: (ms: number) => Promise<void>;
}

const realWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createLogsStore(deps: LogsStoreDeps) {
  const { projectId, sessionSlug, socket } = deps;
  const wait = deps.wait ?? realWait;

  const [state, setState] = createStore<LogsState>({ lines: [], isConnected: false });

  let connectedService = "";
  let isManualDisconnect = false;
  let retryDelay = INITIAL_RETRY_DELAY_MS;
  let attemptEpoch = 0;

  function connect(service: string): void {
    isManualDisconnect = false;
    connectedService = service;
    socket.connect(projectId, sessionSlug, service);
  }

  function scheduleReconnect(): void {
    if (isManualDisconnect) return;
    const epoch = ++attemptEpoch;
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
    void (async () => {
      await wait(delay);
      if (epoch !== attemptEpoch) return;
      connect(connectedService);
    })();
  }

  socket.on("open", () => {
    retryDelay = INITIAL_RETRY_DELAY_MS;
    setState({ isConnected: true });
  });
  socket.on("data", (text) => {
    setState("lines", (lines) => [...lines, text]);
  });
  socket.on("close", () => {
    setState({ isConnected: false });
    scheduleReconnect();
  });

  /** Opens the initial connection to `service` -- call once when the dialog mounts. */
  function start(service: string): void {
    connect(service);
  }

  /** Closes the current socket and reconnects to `newService` with a fresh (empty) buffer. */
  function switchService(newService: string): void {
    isManualDisconnect = true;
    attemptEpoch += 1;
    setState({ lines: [], isConnected: false });
    socket.close();
    connect(newService);
  }

  /** Re-attaches to the same service -- see terminalStore.ts's retry() for the same rationale. */
  function reconnect(): void {
    connect(connectedService);
  }

  /** Disposes the underlying socket -- for the dialog's cleanup on unmount. */
  function close(): void {
    isManualDisconnect = true;
    attemptEpoch += 1;
    socket.close();
  }

  return { state, start, switchService, reconnect, close };
}

export type LogsStore = ReturnType<typeof createLogsStore>;
