// Ports kmp/composeApp/.../domain/TerminalClipboard.kt -- direct port of
// public/terminal-clipboard.js's isCopyShortcut/copyResultMessage, the
// pre-KMP web client's proven fix for xterm.js's hidden-textarea Cmd+C gap
// (see docs/adr/0002-web-terminal-embedding.md).
export interface CopyShortcutInput {
  type: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  key: string;
}

// shiftKey is excluded so Cmd+Shift+C/Ctrl+Shift+C (Chrome/Edge's
// inspect-element devtools shortcut on every OS) never gets silently
// claimed as a copy whenever the terminal happens to have an active
// selection.
//
// ctrlKey is included alongside metaKey (not just as a Windows/Linux
// substitute for Cmd) so plain Ctrl+C is *also* recognized as a copy
// attempt -- deliberately, same convention as coollabsio/coolify's
// terminal.js. The caller only treats this as a real copy when the
// terminal has an active selection; with no selection it falls through
// unclaimed so the real ^C byte still reaches the shell as SIGINT.
export function isCopyShortcut(input: CopyShortcutInput): boolean {
  return (
    input.type === "keydown" &&
    (input.metaKey || input.ctrlKey) &&
    !input.shiftKey &&
    input.key.toLowerCase() === "c"
  );
}

// Insecure origins (plain HTTP on a non-localhost host, e.g. the
// Tailscale/WireGuard deployment this app recommends) don't expose
// navigator.clipboard, and even the execCommand("copy") fallback can fail
// depending on the browser -- the message tells the user which happened so
// a silent failure doesn't look identical to a silent success.
export function copyResultMessage(success: boolean): string {
  return success ? "Copied" : "Auto-copy failed — select the text and copy manually";
}

// Cmd+C has no other meaning in this app (unlike Ctrl+C, which is also the
// shell's interrupt signal), so if it fires with nothing selected the user
// almost certainly dragged without the modifier that bypasses tmux's own
// mouse-reporting capture (tmux runs with `mouse on`).
export const COPY_NO_SELECTION_MESSAGE =
  "No text selected — hold Option (Mac) or Shift (Windows/Linux) while dragging, then copy again";
