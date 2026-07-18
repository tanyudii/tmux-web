package com.tanyudii.tmuxweb.terminal

/**
 * Delivers the platform-specific side of a bell alert once
 * TerminalViewModel.onBell(...) has already decided (via the shared cooldown
 * in domain/BellAlert.kt) that this bell should actually be shown — see plan
 * §2.6's bell-alert unification decision. [title] is the shared
 * domain/BellAlert.kt's buildBellTitle(sessionLabel) output — platforms that
 * have no on-screen text to show (iOS haptic-only, JVM no-op) simply ignore
 * it.
 */
expect fun triggerBellFeedback(title: String)
