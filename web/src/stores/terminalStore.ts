// Ports presentation/TerminalViewModel.kt + TerminalSession.kt. The
// resize-before-open / message-ordering fixes documented in CLAUDE.md
// already live inside api/terminalSocket.ts itself (queue + coalesce), so
// this store only owns what that socket abstraction deliberately doesn't:
// auto-reconnect backoff and the bell-alert cooldown/away-detection
// decision (domain/bellAlert.ts) that TerminalView.tsx (Phase 4) forwards
// but never decides on its own.
import { createStore } from "solid-js/store";
import { SESSION_ENDED_CLOSE_CODE, type ScrollDirection, type TerminalSocket } from "../api/terminalSocket";
import { buildBellTitle, shouldPlayBellAlert } from "../domain/bellAlert";
import { triggerBellFeedback as realTriggerBellFeedback } from "../terminal/bellFeedback";
import type { TerminalHandle } from "../terminal/TerminalView";

const RECONNECT_INITIAL_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;

// "ended" is terminal in both senses: the tmux session no longer exists, so
// unlike "disconnected" (which a Retry can still recover) there is nothing to
// reconnect to. Kept separate rather than reusing "disconnected" so the UI can
// offer "go back" instead of a Retry that could only ever fail.
export type ConnectionPhase = "connected" | "reconnecting" | "disconnected" | "ended";

export interface TerminalStoreState {
  phase: ConnectionPhase;
}

export interface TerminalStoreDeps {
  socket: TerminalSocket;
  sessionFullName: string;
  sessionLabel: string | null;
  pane?: number;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  hasFocus?: () => boolean;
  isHidden?: () => boolean;
  isMuted?: () => boolean;
  // Injectable so tests can assert the alert *decision* without exercising
  // the real title-flash/beep/Notification side effects (already covered
  // by terminal/bellFeedback.test.ts on its own).
  triggerBellFeedback?: (title: string) => void;
}

const realWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const realNow = (): number => Date.now();
const realHasFocus = (): boolean => (typeof document !== "undefined" ? document.hasFocus() : true);
const realIsHidden = (): boolean => (typeof document !== "undefined" ? document.hidden : false);

export function createTerminalStore(deps: TerminalStoreDeps) {
  const { socket, sessionFullName, sessionLabel } = deps;
  const pane = deps.pane ?? 0;
  const wait = deps.wait ?? realWait;
  const now = deps.now ?? realNow;
  const hasFocus = deps.hasFocus ?? realHasFocus;
  const isHidden = deps.isHidden ?? realIsHidden;
  const isMuted = deps.isMuted ?? (() => false);
  const triggerBellFeedback = deps.triggerBellFeedback ?? realTriggerBellFeedback;

  const [state, setState] = createStore<TerminalStoreState>({ phase: "connected" });

  let handle: TerminalHandle | null = null;
  let lastAlertAt: number | null = null;
  let reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
  // Bumped by dispose()/manual retry so a stale scheduled reconnect from a
  // superseded attempt never fires after the store's moved on.
  let attemptEpoch = 0;

  function onOpen(): void {
    setState({ phase: "connected" });
    reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
  }

  function onData(text: string): void {
    handle?.write(text);
  }

  async function onClose(code: number): Promise<void> {
    if (state.phase === "disconnected") return; // dispose() already gave up
    // The server closes with this code only after confirming with tmux that the
    // session is really gone (a detach keeps the session alive and still gets a
    // plain close, so it still reconnects). Retrying here would loop forever
    // against a session that will never come back -- which is exactly what
    // closing the last window used to produce.
    if (code === SESSION_ENDED_CLOSE_CODE) {
      attemptEpoch += 1; // cancel any reconnect already scheduled
      setState({ phase: "ended" });
      return;
    }
    setState({ phase: "reconnecting" });
    const epoch = attemptEpoch;
    await wait(reconnectDelay);
    if (epoch !== attemptEpoch) return;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
    socket.connect(sessionFullName, pane);
  }

  socket.on("open", onOpen);
  socket.on("data", onData);
  socket.on("close", (code) => void onClose(code));
  socket.connect(sessionFullName, pane);

  function onReady(readyHandle: TerminalHandle): void {
    handle = readyHandle;
  }

  function onInput(data: string): void {
    socket.sendInput(data);
  }

  function onResize(cols: number, rows: number): void {
    socket.sendResize(cols, rows);
  }

  function onScroll(direction: ScrollDirection, lines: number): void {
    socket.sendScroll(direction, lines);
  }

  function onBell(): void {
    const shouldAlert = shouldPlayBellAlert({
      muted: isMuted(),
      hasFocus: hasFocus(),
      hidden: isHidden(),
      lastAlertAt,
      now: now(),
    });
    if (!shouldAlert) return;
    lastAlertAt = now();
    triggerBellFeedback(buildBellTitle(sessionLabel));
  }

  /** Manual reconnect for the "Reconnecting…"/"Disconnected" banner's Retry action. */
  function retry(): void {
    attemptEpoch += 1;
    reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
    setState({ phase: "reconnecting" });
    socket.connect(sessionFullName, pane);
  }

  function dispose(): void {
    attemptEpoch += 1;
    setState({ phase: "disconnected" });
    socket.close();
  }

  return { state, onReady, onInput, onResize, onScroll, onBell, retry, dispose };
}

export type TerminalStore = ReturnType<typeof createTerminalStore>;
