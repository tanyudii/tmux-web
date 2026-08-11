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

export interface WheelScrollHandlers {
  /** Receives a pixel delta in the "positive = scroll down" convention. */
  onWheel: (deltaPx: number) => void;
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

    // Always swallow the event, even for the modifier gestures below --
    // letting one through does NOT preserve zoom, it just hands the event
    // to xterm.js, which cancels it itself AND does the alt-buffer
    // arrow-key translation, reopening the very bug this module fixes.
    // A Mac trackpad pinch is delivered as wheel + ctrlKey, so an early
    // return here reintroduced shell-history output for pinch gestures on
    // exactly the hardware that reported the original bug.
    wheelEvent.preventDefault();
    wheelEvent.stopPropagation();

    // Ctrl/Cmd + wheel is a zoom intent, not a scroll -- swallowed above,
    // but deliberately not translated into a tmux scroll. (This app's own
    // zoom is keyboard-driven, see keydownHandlers.ts's Ctrl/Cmd +/-/0.)
    if (wheelEvent.ctrlKey || wheelEvent.metaKey) return;

    handlers.onWheel(deltaPx);
  };

  container.addEventListener("wheel", onWheel, { passive: false, capture: true });

  return () => {
    container.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
  };
}
