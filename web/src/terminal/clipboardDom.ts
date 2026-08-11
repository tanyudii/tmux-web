// DOM-side clipboard write + copy-feedback toast -- ports
// kmp/.../terminal/XtermJs.kt's copyTextToClipboard/showCopyToast/hideCopyToast.
//
// navigator.clipboard.writeText needs a secure context (HTTPS/localhost);
// on an insecure-origin deployment (this app's own recommended plain-HTTP
// WireGuard/Tailscale tunnel, see CLAUDE.md's "Clipboard paste into Web
// text fields is impossible on insecure origins" note) it's undefined
// entirely, so this always falls back to the legacy execCommand("copy")
// path there -- write-side execCommand("copy") is still allowed by
// browsers, unlike the read-side paste restriction documented there.
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return copyViaExecCommand(text);
    }
  }
  return copyViaExecCommand(text);
}

// iOS Safari ignores `textarea.select()` on a field it considers
// non-editable, and treats a plain `readOnly` textarea as exactly that --
// execCommand("copy") then reports success while putting nothing on the
// clipboard. The combination that does work there is contentEditable="true"
// + readOnly (editable enough for the selection to take, still not
// focusable-for-typing enough to pop the on-screen keyboard) followed by an
// explicit setSelectionRange; `select()` alone is the documented no-op.
// Desktop browsers are unaffected by any of this, so there is no branch on
// user agent -- the iOS-safe sequence is simply the sequence.
//
// font-size 16px matters for the same reason: anything smaller makes iOS
// zoom the viewport when the field takes focus, which on this app would
// visibly jolt the terminal mid-copy.
function copyViaExecCommand(text: string): boolean {
  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.readOnly = true;
  scratch.contentEditable = "true";
  scratch.style.position = "fixed";
  scratch.style.top = "0";
  scratch.style.opacity = "0";
  scratch.style.fontSize = "16px";
  document.body.appendChild(scratch);

  const restoreSelection = captureSelection();
  const selection = window.getSelection();
  const scratchRange = document.createRange();
  scratchRange.selectNodeContents(scratch);
  selection?.removeAllRanges();
  selection?.addRange(scratchRange);
  scratch.setSelectionRange(0, text.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  scratch.remove();
  restoreSelection();
  return copied;
}

/**
 * Snapshots the live document selection and returns a function that puts it
 * back. The copy path above has to hijack the selection to reach the
 * clipboard, but on the mobile copy flow the selection being hijacked is the
 * terminal text the user just picked out by hand -- losing it on the very
 * tap that copies it reads as the app throwing their selection away.
 */
function captureSelection(): () => void {
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)) : [];
  return () => {
    if (!selection) return;
    selection.removeAllRanges();
    for (const range of ranges) selection.addRange(range);
  };
}

const TOAST_CLASS = "tmux-copy-toast";

// Shared by every copy path (Cmd+C in keydownHandlers.ts, the mobile Copy
// button in selectionMode.ts) so the same action never reports itself for a
// different length depending on which surface triggered it.
export const COPY_TOAST_DURATION_MS = 1800;
export const NO_SELECTION_TOAST_DURATION_MS = 3200;

interface ToastElement extends HTMLDivElement {
  tmuxHideTimer?: ReturnType<typeof setTimeout>;
}

function findOrCreateToast(container: HTMLElement): ToastElement {
  const existing = container.querySelector<ToastElement>(`.${TOAST_CLASS}`);
  if (existing) return existing;

  const toast = document.createElement("div") as ToastElement;
  toast.className = TOAST_CLASS;
  Object.assign(toast.style, {
    position: "absolute",
    right: "16px",
    bottom: "16px",
    padding: "6px 12px",
    borderRadius: "8px",
    background: "#1B212C",
    color: "#E6E9EF",
    fontSize: "13px",
    fontFamily: "sans-serif",
    zIndex: "10",
    pointerEvents: "none",
  });
  container.appendChild(toast);
  return toast;
}

/** durationMs <= 0 leaves the toast up indefinitely (used for copy failures, which stay until the user copies again). */
export function showCopyToast(container: HTMLElement, message: string, success: boolean, durationMs: number): void {
  const toast = findOrCreateToast(container);
  toast.textContent = message;
  toast.style.border = `1px solid ${success ? "#3ECF8E" : "#F4685F"}`;
  toast.style.display = "block";
  if (toast.tmuxHideTimer) clearTimeout(toast.tmuxHideTimer);
  if (durationMs > 0) {
    toast.tmuxHideTimer = setTimeout(() => {
      toast.style.display = "none";
    }, durationMs);
  }
}

/** Hides and clears any pending auto-dismiss timer, so a stale failure message doesn't resurface later. */
export function hideCopyToast(container: HTMLElement): void {
  const toast = container.querySelector<ToastElement>(`.${TOAST_CLASS}`);
  if (!toast) return;
  if (toast.tmuxHideTimer) clearTimeout(toast.tmuxHideTimer);
  toast.style.display = "none";
}
