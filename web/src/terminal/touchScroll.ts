// Turns single-finger touch drags into raw pixel deltas for the caller to
// fold into tmux copy-mode scroll lines (domain/terminalScroll.ts's
// accumulateScrollLines) -- ports
// kmp/.../terminal/TerminalTouchScroll.wasmJs.kt.
//
// xterm.js has its own touch handling, but it scrolls its local scrollback
// buffer -- the wrong buffer here. tmux repaints its pane by cursor
// addressing, so the real scrollback lives in tmux, not in xterm, and
// xterm's local buffer stays effectively empty (true regardless of tmux's
// `mouse` setting); dragging would otherwise scroll nothing at all. See
// wheelScroll.ts for the equivalent wheel/trackpad path.
//
// touchmove must be non-passive so preventDefault() can stop iOS's
// rubber-band overscroll from hijacking the drag. touchstart stays passive
// -- it's only read, never cancelled, so a tap still reaches xterm and
// still focuses the terminal. Multi-touch is ignored outright: pinch-zoom
// is not ours to interpret.
export interface TouchScrollHandlers {
  onStart: () => void;
  onDrag: (deltaY: number) => void;
  // Read fresh on every event (not captured once at attach time) so the
  // caller can flip selection mode on and off without detaching listeners.
  // While it returns false this module gets out of the way entirely --
  // crucially including the preventDefault, which is what iOS's own
  // long-press selection and drag handles need in order to work at all.
  // Defaults to always-enabled when omitted.
  isEnabled?: () => boolean;
}

export function attachTouchScroll(container: HTMLElement, handlers: TouchScrollHandlers): () => void {
  let lastY = 0;
  const isEnabled = (): boolean => handlers.isEnabled?.() ?? true;

  const onTouchStart = (event: TouchEvent): void => {
    if (!isEnabled()) return;
    if (event.touches.length !== 1) return;
    lastY = event.touches[0].clientY;
    handlers.onStart();
  };

  const onTouchMove = (event: TouchEvent): void => {
    if (!isEnabled()) return;
    if (event.touches.length !== 1) return;
    const y = event.touches[0].clientY;
    const delta = y - lastY;
    lastY = y;
    if (delta !== 0) handlers.onDrag(delta);
    event.preventDefault();
  };

  container.addEventListener("touchstart", onTouchStart as EventListener, { passive: true });
  container.addEventListener("touchmove", onTouchMove as EventListener, { passive: false });

  return () => {
    container.removeEventListener("touchstart", onTouchStart as EventListener);
    container.removeEventListener("touchmove", onTouchMove as EventListener);
  };
}
