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

function copyViaExecCommand(text: string): boolean {
  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.style.position = "fixed";
  scratch.style.opacity = "0";
  document.body.appendChild(scratch);
  scratch.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  scratch.remove();
  return copied;
}

const TOAST_CLASS = "tmux-copy-toast";

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
