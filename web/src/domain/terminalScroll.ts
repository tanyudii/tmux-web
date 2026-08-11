// Ports kmp/composeApp/.../domain/TerminalScroll.kt -- folds a pixel drag
// delta into whole terminal lines, carrying the sub-line remainder across
// calls. tmux's copy-mode scrollback only moves in whole lines, but a
// single touchmove is usually a fraction of one line; dropping that
// fraction would make a slow drag report nothing at all, so the remainder
// is returned as `carry` for the caller to pass back in.
export interface ScrollAccumulation {
  lines: number;
  carry: number;
}

/**
 * `deltaPx` follows the "positive = scroll down" sign convention (callers
 * negate a raw finger delta, since dragging *down* means scrolling *up*
 * into history). Truncation toward zero, and subtracting whole lines from
 * the accumulator rather than resetting it, mirror the native app's own
 * `reportScroll` so every platform scrolls at the same rate for the same
 * gesture.
 *
 * Returns 0 lines (carry unchanged) when `pixelsPerLine` is not positive --
 * that means the terminal hasn't been laid out/fitted yet, so there is no
 * meaningful pixels-per-line ratio to divide by.
 */
export function accumulateScrollLines(deltaPx: number, pixelsPerLine: number, carry: number): ScrollAccumulation {
  if (pixelsPerLine <= 0 || deltaPx === 0) return { lines: 0, carry };
  const total = carry + deltaPx / pixelsPerLine;
  const lines = Math.trunc(total);
  return { lines, carry: total - lines };
}
