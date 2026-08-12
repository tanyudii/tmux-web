// Turns a finger drag into wheel events that xterm.js will encode as mouse
// escapes for the running app.
//
// WHY THIS EXISTS: the desktop fix for "Claude Code's chat won't scroll"
// (see wheelScroll.ts) is simply to stop swallowing the wheel, because
// xterm.js already translates a real wheel into the mouse escape the app
// asked for. That trick has nothing to work with on touch: xterm.js has no
// touch->mouse-wheel translation at all, and browsers do not synthesize
// `wheel` from a drag. So on mobile the gesture has to be manufactured.
//
// It is deliberately xterm.js that does the ENCODING, not this module. The
// wire format depends on which mouse encoding the app negotiated (X10 vs
// SGR `CSI ? 1006 h` vs urxvt) and on modifier state, and xterm.js already
// tracks all of it -- xterm exposes `mouseTrackingMode` but NOT the
// encoding, so hand-rolling `CSI < 64 ; x ; y M` here would be a guess that
// silently corrupts input for any app that did not happen to pick SGR.
// Dispatching a plain DOM wheel event instead reuses xterm's own encoder
// and stays correct for every mode it supports.
//
// The event is dispatched on the deepest xterm element rather than on our
// own container because DOM events bubble UP: xterm's listeners live on
// `.xterm`/`.xterm-viewport`, which are DESCENDANTS of the container this
// app owns, so an event dispatched on the container would never reach them.

/** Where the gesture currently is, in viewport coordinates. */
export interface WheelPoint {
  clientX: number;
  clientY: number;
}

/**
 * Element xterm.js renders its cells into. Wheel events dispatched here
 * bubble up through `.xterm-viewport` and `.xterm`, hitting whichever of
 * them xterm attached its mouse listener to.
 */
function resolveWheelTarget(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".xterm-screen") ?? container.querySelector<HTMLElement>(".xterm");
}

/**
 * Dispatches [notches] wheel events of [pixelsPerNotch] each, in the
 * direction of [deltaPx] ("positive = down", matching WheelEvent.deltaY).
 *
 * One event per notch, rather than a single big delta: a wheel-driven app
 * scrolls by discrete notches, and xterm emits one mouse escape per wheel
 * event regardless of how large its delta is -- so a single event carrying
 * ten lines' worth of pixels would scroll the app by exactly one line.
 *
 * Returns the number of events actually dispatched (0 when xterm has not
 * rendered yet), so the caller can fall back to the tmux copy-mode path
 * instead of silently swallowing the gesture.
 */
export function dispatchWheelNotches(
  container: HTMLElement,
  notches: number,
  deltaPxPerNotch: number,
  point: WheelPoint,
): number {
  const target = resolveWheelTarget(container);
  if (!target || notches <= 0 || deltaPxPerNotch === 0) return 0;

  for (let i = 0; i < notches; i += 1) {
    target.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: point.clientX,
        clientY: point.clientY,
        deltaY: deltaPxPerNotch,
        deltaMode: 0, // DOM_DELTA_PIXEL
      }),
    );
  }
  return notches;
}
