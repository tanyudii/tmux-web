// Detects "an Option-held drag just finished over the terminal" so the
// caller can relay tmux's own resulting copy-mode paste buffer to the real
// OS clipboard on the next Cmd+C -- ports
// kmp/.../terminal/TerminalOptionDragCapture.wasmJs.kt. See
// keydownHandlers.ts for the Cmd+C side that consumes this.
//
// A small movement threshold distinguishes an actual drag-selection from an
// Option-click with no movement, which tmux's default mouse bindings don't
// copy anything for -- without this, onDragEnded would fire on every such
// click and relay whatever stale text happens to already be in tmux's paste
// buffer (from an earlier, unrelated copy) as if it were freshly selected.
const DRAG_THRESHOLD_PX = 4;

export function attachOptionDragCaptureListener(container: HTMLElement, onDragEnded: () => void): () => void {
  const thresholdSq = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
  const ownerDocument = container.ownerDocument;

  const onMouseDown = (event: MouseEvent): void => {
    if (!event.altKey || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;

    const onMouseUp = (upEvent: MouseEvent): void => {
      ownerDocument.removeEventListener("mouseup", onMouseUp);
      const dx = upEvent.clientX - startX;
      const dy = upEvent.clientY - startY;
      if (dx * dx + dy * dy >= thresholdSq) onDragEnded();
    };
    ownerDocument.addEventListener("mouseup", onMouseUp);
  };

  ownerDocument.addEventListener("mousedown", onMouseDown);
  return () => ownerDocument.removeEventListener("mousedown", onMouseDown);
}
