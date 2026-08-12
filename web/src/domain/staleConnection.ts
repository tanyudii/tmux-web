// Decides when a terminal WebSocket that still *claims* to be open should
// be treated as dead and reconnected. Pure, same split as domain/bellAlert.ts:
// the clock and the DOM events are passed in, so stores/terminalStore.ts
// owns the side effects and this stays testable without fake timers.
//
// Why this exists at all: the browser WebSocket API exposes no ping/pong to
// JS, so a page cannot run the protocol-level keepalive the server does
// (src/ws-heartbeat.ts). When the network path dies silently the browser
// keeps reporting `readyState === OPEN` forever -- `onclose` never fires,
// terminalStore stays in phase "connected", and the user sees a frozen
// terminal with no banner and no reconnect. Both heuristics below are
// therefore about inferring death from ordinary application signals.

/**
 * How long a keystroke may go unanswered before the socket is presumed dead.
 *
 * tmux answers *any* keystroke with a redraw or at least a cursor move, so
 * "the user typed and nothing at all came back" is strong evidence. Held
 * deliberately above a human's patience for a busy TUI (a full-screen app
 * mid-render can be quiet for a beat) because the cost of a false positive
 * is one re-attach and redraw, while the cost of a miss is a terminal the
 * user has to reload the page to recover.
 */
export const STALE_INPUT_THRESHOLD_MS = 5000;

/**
 * How long the page must have been hidden before returning to it is treated
 * as a resume worth reconnecting for.
 *
 * A quick desktop alt-tab must NOT reconnect: every reconnect kills and
 * respawns a `tmux attach-session` and repaints the pane, so doing it on
 * each tab switch would be visible flicker and pointless load. A phone that
 * was locked, or a tab the OS froze, is the case that matters -- and that is
 * always far longer than this.
 */
export const RESUME_RECONNECT_THRESHOLD_MS = 20_000;

export interface ShouldProbeReconnectInput {
  /** When the user last sent a keystroke, or null if they have not since the last probe. */
  lastInputAt: number | null;
  /** When a frame last arrived from the server, or null if none has. */
  lastDataAt: number | null;
  now: number;
  thresholdMs?: number;
}

/**
 * True when input was sent and nothing has come back since, for longer than
 * the threshold. Silence on its own is never enough -- an idle shell is
 * legitimately silent for hours.
 */
export function shouldProbeReconnect(input: ShouldProbeReconnectInput): boolean {
  const { lastInputAt, lastDataAt, now } = input;
  const thresholdMs = input.thresholdMs ?? STALE_INPUT_THRESHOLD_MS;

  if (lastInputAt === null) return false;
  // Anything received at or after the keystroke means the socket answered.
  if (lastDataAt !== null && lastDataAt >= lastInputAt) return false;

  return now - lastInputAt >= thresholdMs;
}

/**
 * True when a page that just became visible again was hidden long enough
 * that its socket is more likely dead than alive.
 */
export function shouldReconnectAfterHidden(hiddenDurationMs: number, thresholdMs = RESUME_RECONNECT_THRESHOLD_MS): boolean {
  return hiddenDurationMs >= thresholdMs;
}
