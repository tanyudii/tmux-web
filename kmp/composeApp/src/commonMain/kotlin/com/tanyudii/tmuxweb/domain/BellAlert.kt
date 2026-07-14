package com.tanyudii.tmuxweb.domain

/**
 * Direct port of public/notify.js's `shouldPlayBellAlert`/`buildBellTitle` —
 * see plan §2.6's "Bell alert" gap: today Web does title-flash + beep +
 * `Notification`, iOS does haptic-only. This pure function is the shared
 * decision logic both platforms drive their own delivery from. Kept
 * dependency-free like the JS original — `now`/`lastAlertAt` are passed in
 * rather than read from a clock, so it stays a pure function under test.
 */
const val BELL_COOLDOWN_MS = 1500L

fun buildBellTitle(sessionName: String?): String {
    val label = if (sessionName.isNullOrEmpty()) "session" else sessionName
    return "🔔 $label needs you — tmux-web"
}

fun shouldPlayBellAlert(
    muted: Boolean,
    hasFocus: Boolean,
    hidden: Boolean,
    lastAlertAt: Long?,
    now: Long,
): Boolean {
    if (muted) return false

    val isAway = hidden || !hasFocus
    if (!isAway) return false

    return lastAlertAt == null || now - lastAlertAt >= BELL_COOLDOWN_MS
}
