// Keeps the app's height equal to the part of the screen that is actually
// visible, so an open virtual keyboard shrinks the layout instead of covering
// it.
//
// WHY CSS ALONE CANNOT DO THIS: `100dvh` accounts for the browser's own
// retracting toolbars, but NOT for the software keyboard -- on iOS the layout
// viewport keeps its full height when the keyboard slides up, and the keyboard
// is simply drawn on top. Combined with this app's `overflow: hidden` shell,
// whatever the keyboard covers becomes unreachable: the terminal's cursor line
// and the Connect screen's fields sat behind it with no way to scroll them into
// view. `window.visualViewport.height` is the only thing that reports the
// keyboard-adjusted size.
//
// The value is published as a custom property rather than an inline height so
// the layout keeps living in the stylesheet; index.css consumes it as
// `var(--app-height, 100dvh)`.
//
// A px value is written even when visualViewport is missing (falling back to
// innerHeight) on purpose: `var(--app-height, 100dvh)` would otherwise resolve
// to `100dvh` on a browser that supports custom properties but not `dvh`
// units, which is invalid at computed-value time and would collapse the shell
// to `height: auto`.

export interface VisualViewportLike {
  height: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface AppHeightDeps {
  /**
   * Whether something is focused that could summon a keyboard. Defaults to
   * "the active element is an input, textarea or contenteditable".
   */
  isTextEntryFocused?: () => boolean;
  /** Subscribes to focus changes; returns an unsubscribe. */
  onFocusChange?: (listener: () => void) => () => void;
  /** Schedules the settle re-read. Injectable so tests need no timers. */
  scheduleSettle?: (run: () => void) => void;
  /** Defaults to `window.visualViewport`; null disables the keyboard-aware path. */
  viewport?: VisualViewportLike | null;
  /** Fallback height source when there is no visualViewport. */
  fallbackHeight?: () => number;
  /** Element carrying the custom property. Defaults to <html>. */
  target?: { style: { setProperty(name: string, value: string): void } };
  /** Window-level resize source, used as a backstop. */
  onWindowResize?: (listener: () => void) => () => void;
}

export const APP_HEIGHT_PROPERTY = "--app-height";

/** Long enough to outlast iOS's keyboard/accessory-bar transition. */
const SETTLE_DELAY_MS = 300;

/**
 * Smallest share of the viewport an overlap must cover before it is treated as
 * a keyboard rather than a keyboard ACCESSORY BAR.
 *
 * With a hardware keyboard attached, iPadOS reserves room for the shortcut bar
 * and reports it through visualViewport exactly like a keyboard -- but the bar
 * is a fraction of the height, and on this reporter's iPad nothing was drawn
 * there at all, so shrinking by it left dead space that grew as they typed.
 *
 * A ratio, not a pixel count, because the two classes separate cleanly by share
 * of the viewport on every device while their pixel values do not. Measured on
 * the reporting iPad and iPhone:
 *
 *   software keyboard  391px portrait / 479px landscape  -> ~38% / ~62%
 *   accessory bar      71px typing, 158px transient      -> ~7%  / ~15%
 *
 * 25% sits in the middle of that gap with a wide margin on both sides. An
 * absolute threshold would not: an iPhone's landscape keyboard is only ~190px,
 * which is close to the iPad's 158px transient, yet as a ratio it is ~55%.
 */
const KEYBOARD_MIN_VIEWPORT_SHARE = 0.25;

// iPadOS keeps reporting a shrunken visual viewport after a keyboard or
// accessory bar has gone, and the value oscillates: measured on a real iPad
// with a hardware keyboard attached and NOTHING focused, the reported overlap
// flipped between 158px and 71px on its own. Sizing the shell from that left a
// strip of dead space below the UI -- the gap this guard exists to stop.
//
// Nothing can cover the page while nothing is focused, so in that state the
// layout viewport is the truth and the visual viewport is simply stale.
function defaultIsTextEntryFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  // xterm.js keeps a hidden <textarea> focused whenever the terminal has focus,
  // so the terminal screen counts as focused -- correctly, since that is exactly
  // when a keyboard is up over it. Verified live: tapping the terminal makes
  // document.activeElement a TEXTAREA.
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  return (el as HTMLElement).isContentEditable === true;
}

function defaultFocusChange(listener: () => void): () => void {
  document.addEventListener("focusin", listener);
  document.addEventListener("focusout", listener);
  return () => {
    document.removeEventListener("focusin", listener);
    document.removeEventListener("focusout", listener);
  };
}

function defaultWindowResize(listener: () => void): () => void {
  window.addEventListener("resize", listener);
  window.addEventListener("orientationchange", listener);
  return () => {
    window.removeEventListener("resize", listener);
    window.removeEventListener("orientationchange", listener);
  };
}

/** Starts syncing; returns a cleanup that removes every listener it added. */
export function attachAppHeight(deps: AppHeightDeps = {}): () => void {
  const viewport =
    deps.viewport !== undefined
      ? deps.viewport
      : typeof window !== "undefined"
        ? (window.visualViewport as VisualViewportLike | null)
        : null;
  const fallbackHeight = deps.fallbackHeight ?? (() => (typeof window === "undefined" ? 0 : window.innerHeight));
  const target = deps.target ?? (typeof document === "undefined" ? undefined : document.documentElement);
  const onWindowResize = deps.onWindowResize ?? defaultWindowResize;
  if (!target) return () => {};

  const isTextEntryFocused = deps.isTextEntryFocused ?? defaultIsTextEntryFocused;
  const onFocusChange = deps.onFocusChange ?? defaultFocusChange;
  const scheduleSettle = deps.scheduleSettle ?? ((run: () => void) => setTimeout(run, SETTLE_DELAY_MS));
  let settleScheduled = false;

  const measure = (): number => {
    const layout = fallbackHeight();
    if (!viewport) return layout;
    // Nothing focused means nothing can be covering the page, whatever the
    // viewport claims -- see defaultIsTextEntryFocused's note.
    if (!isTextEntryFocused()) return layout;

    const overlap = layout - viewport.height;
    if (overlap <= 0) return layout;
    // Too small a share to be a keyboard: an accessory bar, or a stale value.
    // Shrinking by it is what produced the growing strip of dead space on iPad.
    if (overlap / layout < KEYBOARD_MIN_VIEWPORT_SHARE) return layout;
    return viewport.height;
  };

  const apply = (): void => {
    const height = measure();
    // Guard against 0/NaN: some browsers report a transient 0 mid-rotation, and
    // committing that would collapse the whole shell for a frame.
    if (!Number.isFinite(height) || height <= 0) return;
    target.style.setProperty(APP_HEIGHT_PROPERTY, `${Math.round(height)}px`);
  };

  // Applied twice: once now so the layout reacts immediately, once after the
  // transition has settled, because the first value iOS reports mid-animation
  // is often not the one it ends on (the 158-then-71 oscillation above).
  const applyAndSettle = (): void => {
    apply();
    if (settleScheduled) return;
    settleScheduled = true;
    scheduleSettle(() => {
      settleScheduled = false;
      apply();
    });
  };

  apply();

  // `scroll` matters as much as `resize`: iOS shifts the visual viewport when
  // it scrolls a focused field into view above the keyboard, and that arrives
  // as a visualViewport scroll rather than a resize.
  viewport?.addEventListener("resize", applyAndSettle);
  viewport?.addEventListener("scroll", applyAndSettle);
  const detachWindow = onWindowResize(applyAndSettle);
  const detachFocus = onFocusChange(applyAndSettle);

  return () => {
    viewport?.removeEventListener("resize", applyAndSettle);
    viewport?.removeEventListener("scroll", applyAndSettle);
    detachWindow();
    detachFocus();
  };
}
