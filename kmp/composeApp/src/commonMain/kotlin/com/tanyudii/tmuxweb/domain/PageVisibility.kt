package com.tanyudii.tmuxweb.domain

/**
 * Current tab-visibility/window-focus state, read at the moment a bell
 * fires -- feeds [shouldPlayBellAlert]'s hidden/hasFocus params (see
 * TerminalSession.onBell) so "away" actually reflects the real browser
 * state instead of a hardcoded value. No platform has a persistent-listener
 * need here (unlike [com.tanyudii.tmuxweb.terminal.observeAppForeground]'s
 * foreground-transition callback) -- both are cheap synchronous reads.
 */
expect fun isPageHidden(): Boolean

expect fun hasWindowFocus(): Boolean
