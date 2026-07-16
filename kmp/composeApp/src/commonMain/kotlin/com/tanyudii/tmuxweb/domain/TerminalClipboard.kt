package com.tanyudii.tmuxweb.domain

/**
 * Direct port of public/terminal-clipboard.js's `isCopyShortcut`/`copyResultMessage` —
 * the pre-KMP web client's proven fix for xterm.js's hidden-textarea Cmd+C gap
 * (see docs/adr/0002-web-terminal-embedding.md and commits 73be7a0/4d5e4e0).
 * Kept DOM-free like the JS original: takes primitive event fields rather than
 * a raw KeyboardEvent so it stays platform-agnostic and testable from commonTest,
 * mirroring BellAlert.kt's shouldPlayBellAlert.
 */
// shiftKey is excluded so Cmd+Shift+C (macOS Chrome/Edge's devtools
// element-inspector shortcut) doesn't get silently claimed as a copy
// whenever the terminal happens to have an active selection.
fun isCopyShortcut(type: String, metaKey: Boolean, shiftKey: Boolean, key: String): Boolean =
    type == "keydown" && metaKey && !shiftKey && key.lowercase() == "c"

// Insecure origins (plain HTTP on a non-localhost host, e.g. the
// Tailscale/WireGuard deployment this app recommends) don't expose
// navigator.clipboard, and even the execCommand("copy") fallback can fail
// depending on the browser. The message tells the user which happened so a
// silent failure doesn't look identical to a silent success. This KMP port
// has no fallback input box (unlike the pre-KMP public/app.js original),
// so the message doesn't reference one.
fun copyResultMessage(success: Boolean): String =
    if (success) "Copied" else "Auto-copy failed — select the text and copy manually"
