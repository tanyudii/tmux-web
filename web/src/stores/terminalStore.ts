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
import { shouldProbeReconnect, shouldReconnectAfterHidden } from "../domain/staleConnection";
import { triggerBellFeedback as realTriggerBellFeedback } from "../terminal/bellFeedback";
import type { TerminalHandle } from "../terminal/TerminalView";

const RECONNECT_INITIAL_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;
/**
 * How often the staleness watchdog checks. Only the *threshold* in
 * domain/staleConnection.ts decides anything; this is just the sampling rate,
 * kept well under it so a stall is noticed promptly without busy-polling.
 */
const WATCHDOG_TICK_MS = 2000;

/**
 * Input that carries at least one printable character. Control-only input
 * (quick-key ^C/^A/^E, real-keyboard Ctrl combos, bare Esc) is excluded from
 * arming the staleness watchdog: tmux sends attached clients only screen
 * diffs, so a keystroke that doesn't change the screen legitimately draws
 * zero reply bytes, and treating that silence as a dead socket reconnects a
 * healthy connection (tap ^C on an idle prompt -> "Reconnecting…" 5s later).
 */
const PRINTABLE_INPUT = /[^\x00-\x1f\x7f]/;

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
  // Staleness watchdog plumbing, injectable for the same reason `wait` is:
  // tests drive the tick by hand rather than waiting real seconds.
  setIntervalFn?: (callback: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
  // Page-lifecycle signals. Defaults wire the real DOM events; tests pass
  // their own emitter. Both return a detach function.
  onVisibilityChange?: (handler: (visible: boolean) => void) => () => void;
  onOnline?: (handler: () => void) => () => void;
}

const realWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const realNow = (): number => Date.now();
const realHasFocus = (): boolean => (typeof document !== "undefined" ? document.hasFocus() : true);
const realIsHidden = (): boolean => (typeof document !== "undefined" ? document.hidden : false);
const realSetInterval = (callback: () => void, ms: number): unknown => setInterval(callback, ms);
const realClearInterval = (handle: unknown): void => clearInterval(handle as ReturnType<typeof setInterval>);

// Deliberately NOT wired to `focus`: on desktop that fires on every
// alt-tab, and each reconnect respawns a `tmux attach-session` and repaints
// the pane. `visibilitychange` plus the hidden-duration threshold in
// domain/staleConnection.ts targets the case that actually breaks -- a
// locked phone or an OS-frozen tab -- without thrashing on tab switches.
const realOnVisibilityChange = (handler: (visible: boolean) => void): (() => void) => {
  if (typeof document === "undefined") return () => {};
  const listener = (): void => handler(!document.hidden);
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};

const realOnOnline = (handler: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", handler);
  return () => window.removeEventListener("online", handler);
};

export function createTerminalStore(deps: TerminalStoreDeps) {
  const { socket, sessionFullName, sessionLabel } = deps;
  const pane = deps.pane ?? 0;
  const wait = deps.wait ?? realWait;
  const now = deps.now ?? realNow;
  const hasFocus = deps.hasFocus ?? realHasFocus;
  const isHidden = deps.isHidden ?? realIsHidden;
  const isMuted = deps.isMuted ?? (() => false);
  const triggerBellFeedback = deps.triggerBellFeedback ?? realTriggerBellFeedback;
  const setIntervalFn = deps.setIntervalFn ?? realSetInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? realClearInterval;
  const onVisibilityChange = deps.onVisibilityChange ?? realOnVisibilityChange;
  const onOnline = deps.onOnline ?? realOnOnline;

  const [state, setState] = createStore<TerminalStoreState>({ phase: "connected" });

  let handle: TerminalHandle | null = null;
  let lastAlertAt: number | null = null;
  let reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
  // Bumped by dispose()/manual retry so a stale scheduled reconnect from a
  // superseded attempt never fires after the store's moved on.
  let attemptEpoch = 0;
  // Last size reported by TerminalView. Replayed on every open: the server
  // spawns each pty at its own DEFAULT_COLS/DEFAULT_ROWS (80x24, see
  // src/main.ts), and TerminalView only reports a size when it *changes* --
  // which it does not across a reconnect, since the view is never
  // remounted, only the socket underneath it. Without this replay every
  // reconnect silently dropped the session to 80x24 while xterm kept
  // painting at the real size, leaving stale pixels outside the top-left
  // corner that never updated again.
  let lastCols: number | null = null;
  let lastRows: number | null = null;
  // Staleness evidence for domain/staleConnection.ts.
  let lastInputAt: number | null = null;
  let lastDataAt: number | null = null;
  let hiddenAt: number | null = null;

  function onOpen(): void {
    setState({ phase: "connected" });
    reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
    lastInputAt = null;
    lastDataAt = now();
    if (lastCols !== null && lastRows !== null) socket.sendResize(lastCols, lastRows);
  }

  function onData(text: string): void {
    lastDataAt = now();
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
    // A synchronous throw out of connect() (a browser can reject `new
    // WebSocket()` outright) used to kill the retry chain for good, pinning
    // the UI at "Reconnecting…" with only the manual Retry button left. Keep
    // the loop alive by treating it as just another failed attempt.
    try {
      socket.connect(sessionFullName, pane);
    } catch {
      void onClose(1006);
    }
  }

  socket.on("open", onOpen);
  socket.on("data", onData);
  socket.on("close", (code) => void onClose(code));
  socket.connect(sessionFullName, pane);

  /**
   * Reconnects now, cancelling any scheduled backoff attempt. Shared by the
   * banner's Retry, the staleness watchdog and the resume handlers -- they
   * differ only in what convinced them the socket is gone.
   */
  function reconnectNow(): void {
    attemptEpoch += 1;
    reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
    lastInputAt = null;
    setState({ phase: "reconnecting" });
    try {
      socket.connect(sessionFullName, pane);
    } catch {
      void onClose(1006);
    }
  }

  /** "ended" has nothing to reconnect to; "disconnected" means dispose() already ran. */
  function canReconnect(): boolean {
    return state.phase === "connected" || state.phase === "reconnecting";
  }

  // The half-open-socket watchdog. The browser exposes no ping/pong to JS,
  // so a dead-but-OPEN socket can only be inferred -- here from a keystroke
  // that tmux never answered. See domain/staleConnection.ts.
  const watchdogHandle = setIntervalFn(() => {
    if (state.phase !== "connected") return;
    if (!shouldProbeReconnect({ lastInputAt, lastDataAt, now: now() })) return;
    reconnectNow();
  }, WATCHDOG_TICK_MS);

  const detachVisibility = onVisibilityChange((visible) => {
    if (!visible) {
      hiddenAt = now();
      return;
    }
    const wasHiddenAt = hiddenAt;
    hiddenAt = null;
    if (wasHiddenAt === null || !canReconnect()) return;
    // Timers are throttled while hidden and frozen outright on a locked
    // phone, so a backoff scheduled before the freeze may never fire on its
    // own -- reconnecting on resume is what actually unsticks that case.
    if (shouldReconnectAfterHidden(now() - wasHiddenAt)) reconnectNow();
  });

  const detachOnline = onOnline(() => {
    if (canReconnect()) reconnectNow();
  });

  function onReady(readyHandle: TerminalHandle): void {
    handle = readyHandle;
  }

  function onInput(data: string): void {
    // Only printable input arms the staleness watchdog -- see PRINTABLE_INPUT.
    if (PRINTABLE_INPUT.test(data)) lastInputAt = now();
    socket.sendInput(data);
  }

  function onResize(cols: number, rows: number): void {
    lastCols = cols;
    lastRows = rows;
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
    reconnectNow();
  }

  function dispose(): void {
    attemptEpoch += 1;
    clearIntervalFn(watchdogHandle);
    detachVisibility();
    detachOnline();
    setState({ phase: "disconnected" });
    socket.close();
  }

  return { state, onReady, onInput, onResize, onScroll, onBell, retry, dispose };
}

export type TerminalStore = ReturnType<typeof createTerminalStore>;
