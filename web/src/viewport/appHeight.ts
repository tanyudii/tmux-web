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

  const apply = (): void => {
    const height = viewport ? viewport.height : fallbackHeight();
    // Guard against 0/NaN: some browsers report a transient 0 mid-rotation, and
    // committing that would collapse the whole shell for a frame.
    if (!Number.isFinite(height) || height <= 0) return;
    target.style.setProperty(APP_HEIGHT_PROPERTY, `${Math.round(height)}px`);
  };

  apply();

  // `scroll` matters as much as `resize`: iOS shifts the visual viewport when
  // it scrolls a focused field into view above the keyboard, and that arrives
  // as a visualViewport scroll rather than a resize.
  viewport?.addEventListener("resize", apply);
  viewport?.addEventListener("scroll", apply);
  const detachWindow = onWindowResize(apply);

  return () => {
    viewport?.removeEventListener("resize", apply);
    viewport?.removeEventListener("scroll", apply);
    detachWindow();
  };
}
