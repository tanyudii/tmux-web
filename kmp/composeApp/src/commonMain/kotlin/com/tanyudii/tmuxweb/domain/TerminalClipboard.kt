package com.tanyudii.tmuxweb.domain

/**
 * Direct port of public/terminal-clipboard.js's `isCopyShortcut`/`copyResultMessage` —
 * the pre-KMP web client's proven fix for xterm.js's hidden-textarea Cmd+C gap
 * (see docs/adr/0002-web-terminal-embedding.md and commits 73be7a0/4d5e4e0).
 * Kept DOM-free like the JS original: takes primitive event fields rather than
 * a raw KeyboardEvent so it stays platform-agnostic and testable from commonTest,
 * mirroring BellAlert.kt's shouldPlayBellAlert.
 */
// shiftKey is excluded so Cmd+Shift+C/Ctrl+Shift+C (Chrome/Edge's
// inspect-element devtools shortcut on every OS -- Cmd+Shift+C on macOS,
// Ctrl+Shift+C on Windows/Linux) never gets silently claimed as a copy
// whenever the terminal happens to have an active selection.
//
// ctrlKey is included alongside metaKey (not just as a Windows/Linux
// substitute for Cmd) so plain Ctrl+C is *also* recognized as a copy
// attempt -- deliberately, same convention as coollabsio/coolify's
// terminal.js. The caller (handleCopyKeyDown in
// TerminalKeydownHandlers.wasmJs.kt) only treats this as a real copy when
// terminal.hasSelection() is true; with no selection it falls through
// unclaimed so the real ^C byte still reaches the shell as SIGINT, same as
// every other terminal. Ctrl+Shift+C was considered and rejected as the
// Windows/Linux copy shortcut instead of reusing Ctrl+C: browser-reserved
// devtools shortcuts like Ctrl+Shift+C can't reliably be suppressed with
// preventDefault(), so binding it would pop the inspector open alongside
// (or instead of) copying.
fun isCopyShortcut(type: String, metaKey: Boolean, ctrlKey: Boolean, shiftKey: Boolean, key: String): Boolean =
    type == "keydown" && (metaKey || ctrlKey) && !shiftKey && key.lowercase() == "c"

// Insecure origins (plain HTTP on a non-localhost host, e.g. the
// Tailscale/WireGuard deployment this app recommends) don't expose
// navigator.clipboard, and even the execCommand("copy") fallback can fail
// depending on the browser. The message tells the user which happened so a
// silent failure doesn't look identical to a silent success. This KMP port
// has no fallback input box (unlike the pre-KMP public/app.js original),
// so the message doesn't reference one.
fun copyResultMessage(success: Boolean): String =
    if (success) "Copied" else "Auto-copy failed — select the text and copy manually"

// Cmd+C has no other meaning in this app (unlike Ctrl+C, which is also the
// shell's interrupt signal), so if it fires with nothing selected the user
// almost certainly dragged without the modifier that bypasses tmux's own
// mouse-reporting capture (tmux runs with `mouse on` -- see
// macOptionClickForcesSelection's comment in XtermJs.kt): tmux swallowed the
// drag into its own internal copy-mode buffer before xterm.js ever saw a
// selection, so hasSelection() is false and there is nothing to copy.
const val COPY_NO_SELECTION_MESSAGE: String =
    "No text selected — hold Option (Mac) or Shift (Windows/Linux) while dragging, then copy again"
