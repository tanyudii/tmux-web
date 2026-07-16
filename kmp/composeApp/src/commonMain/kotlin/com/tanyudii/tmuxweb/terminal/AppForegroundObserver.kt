package com.tanyudii.tmuxweb.terminal

/**
 * Observes the OS/browser bringing this app/tab back to the foreground.
 * iOS Safari (and iOS apps generally) suspends or outright closes a
 * backgrounded tab's WebSocket -- without this, a dropped connection is only
 * discovered the next time the user happens to touch the terminal, since
 * nothing else prompts a reconnect attempt right away (TerminalViewModel's
 * own backoff loop still recovers eventually, this is just the fast path).
 * Returns a disposer to call from `onDispose`.
 *
 * wasmJs listens for `visibilitychange`/`pageshow`; iOS observes
 * `UIApplicationDidBecomeActiveNotification` (the same signal the pre-KMP
 * SwiftUI app drove off `scenePhase == .active` before commit 2d3b55c
 * removed it). No-op on JVM, which has no such foreground/background concept.
 */
expect fun observeAppForeground(onForeground: () -> Unit): () -> Unit
