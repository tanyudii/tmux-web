// Turns mouse-wheel / trackpad scrolling over the terminal into raw pixel
// deltas for the caller to fold into tmux copy-mode scroll lines, exactly
// like touchScroll.ts already does for finger drags.
//
// WHY THIS EXISTS (found live on a Mac trackpad): without it, scrolling the
// terminal printed shell history instead of scrolling. tmux always runs in
// the terminal's ALTERNATE screen buffer, and xterm.js deliberately
// translates wheel events into cursor-key sequences (ESC [ A / ESC [ B)
// while the alt buffer is active -- the standard xterm convention that
// makes a wheel work inside `less`/`man`. Those arrow keys reach the shell,
// where readline interprets them as previous-/next-command. So the gesture
// produced history entries rather than scrollback.
//
// The previous assumption (documented in TerminalView.tsx) was that a wheel
// "reaches tmux without us" because xterm forwards it as an SGR mouse
// escape -- but that only holds when tmux is configured with `mouse on`.
// tmux's default is `mouse off`, and this project never sets it, so on a
// default install nothing forwarded the wheel and xterm's alt-buffer
// arrow-key fallback took over instead.
//
// Handling it ourselves makes scrolling work identically regardless of the
// user's tmux config, and routes it through the same explicit
// `scroll` message the touch path uses (see api/terminalSocket.ts's
// sendScroll -> src/pty-bridge.ts's scrollPaneFn -> tmux copy-mode).
//
// Registered in the CAPTURE phase, non-passive: xterm.js attaches its own
// wheel listener to an element *inside* this container, so capturing here
// runs first and stopPropagation() keeps the event from ever reaching it --
// which is what actually suppresses the arrow-key translation.

/** Rough line height used to convert a `deltaMode: line` wheel event to pixels. */
const LINES_TO_PIXELS = 16;
/** Fallback page height for `deltaMode: page`, used only when the container has no height yet. */
const PAGE_FALLBACK_PIXELS = 400;

// EXCEPTION to all of the above: a full-screen app that has turned mouse
// tracking ON (Claude Code, htop, a `mouse`-enabled vim) draws its own
// scrollable view and expects the wheel as an SGR mouse escape. Two facts
// make hijacking actively wrong there, confirmed live against a real
// `claude` pane: the pane reports `alternate_on=1` with `history_size=0`,
// so the tmux copy-mode this module drives has literally nothing to scroll
// -- it just freezes the pane in a mode whose keytable then eats
// keystrokes; and `mouse_any_flag=1`/`mouse_sgr_flag=1`, i.e. the app did
// ask for the wheel. Because tmux runs `mouse off`, it forwards the app's
// mouse-mode request out to xterm.js and forwards the resulting events back
// down, so simply NOT swallowing the event makes xterm.js do the right
// thing on its own. The alt-buffer arrow-key translation this module exists
// to suppress does not apply in that case either -- xterm.js emits a mouse
// escape instead of arrows whenever mouse tracking is active.
export interface WheelScrollHandlers {
  /** Receives a pixel delta in the "positive = scroll down" convention. */
  onWheel: (deltaPx: number) => void;
  /**
   * False while the running app wants the wheel itself, in which case the
   * event is left completely untouched (no preventDefault, no
   * stopPropagation) so xterm.js can forward it as a mouse escape.
   */
  isEnabled?: () => boolean;
}

/** Normalizes a wheel event's delta to pixels, whatever unit it reports in. */
export function wheelDeltaToPixels(event: WheelEvent, containerHeight: number): number {
  switch (event.deltaMode) {
    case 1: // DOM_DELTA_LINE
      return event.deltaY * LINES_TO_PIXELS;
    case 2: // DOM_DELTA_PAGE
      return event.deltaY * (containerHeight > 0 ? containerHeight : PAGE_FALLBACK_PIXELS);
    default: // DOM_DELTA_PIXEL
      return event.deltaY;
  }
}

/** Returns a cleanup function that detaches the listener. */
export function attachWheelScroll(container: HTMLElement, handlers: WheelScrollHandlers): () => void {
  const onWheel = (event: Event): void => {
    const wheelEvent = event as WheelEvent;
    const deltaPx = wheelDeltaToPixels(wheelEvent, container.clientHeight);
    if (deltaPx === 0) return;

    // Ctrl/Cmd + wheel is a zoom intent, not a scroll. Swallowed
    // unconditionally -- ahead of the mouse-tracking check below, because
    // letting it through does NOT preserve zoom, it just hands the event to
    // xterm.js (and to the browser's own page zoom). A Mac trackpad pinch
    // is delivered as wheel + ctrlKey, so an early return here reintroduced
    // shell-history output for pinch gestures on exactly the hardware that
    // reported the original bug. (This app's own zoom is keyboard-driven,
    // see keydownHandlers.ts's Ctrl/Cmd +/-/0.)
    if (wheelEvent.ctrlKey || wheelEvent.metaKey) {
      wheelEvent.preventDefault();
      wheelEvent.stopPropagation();
      return;
    }

    // Hand the wheel to the running app untouched when it asked for it.
    if (handlers.isEnabled && !handlers.isEnabled()) return;

    wheelEvent.preventDefault();
    wheelEvent.stopPropagation();
    handlers.onWheel(deltaPx);
  };

  container.addEventListener("wheel", onWheel, { passive: false, capture: true });

  return () => {
    container.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
  };
}
