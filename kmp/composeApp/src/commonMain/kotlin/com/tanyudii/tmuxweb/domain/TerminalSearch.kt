package com.tanyudii.tmuxweb.domain

/**
 * EMB-219: whether a keydown is the "open terminal search" shortcut.
 * DOM-free like [isCopyShortcut] so it stays testable from commonTest.
 * Ctrl+F is included alongside Cmd+F (unlike [isCopyShortcut], which only
 * checks metaKey) because Ctrl+F has no existing meaning to a shell/tmux --
 * intercepting it is safe on every platform, not just macOS.
 */
fun isFindShortcut(type: String, ctrlKey: Boolean, metaKey: Boolean, key: String): Boolean =
    type == "keydown" && (ctrlKey || metaKey) && key.lowercase() == "f"
