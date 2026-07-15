package com.tanyudii.tmuxweb.terminal

/**
 * Delivers the platform-specific side of a bell alert once
 * TerminalViewModel.onBell(...) has already decided (via the shared cooldown
 * in domain/BellAlert.kt) that this bell should actually be shown — see plan
 * §2.6's bell-alert unification decision.
 */
expect fun triggerBellFeedback()
