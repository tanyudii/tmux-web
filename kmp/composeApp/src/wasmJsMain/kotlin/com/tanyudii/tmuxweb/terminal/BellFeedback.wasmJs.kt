package com.tanyudii.tmuxweb.terminal

actual fun triggerBellFeedback() {
    // Web bell delivery (title flash + beep + Notification, per plan §2.6) is
    // out of scope for this rebuild pass — no-op so the shared Terminal
    // screen compiles and behaves identically (silently) on both targets
    // until that follow-up work lands.
}
