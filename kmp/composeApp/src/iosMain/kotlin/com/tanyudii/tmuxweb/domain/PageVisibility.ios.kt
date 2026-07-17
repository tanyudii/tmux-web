package com.tanyudii.tmuxweb.domain

// iOS has no analogous "page hidden"/"window focus" concept -- the app is
// either running in the foreground or suspended (no code executes at all
// while suspended), so there's nothing meaningful to report as hidden or
// unfocused while this can even run. Bell delivery on iOS goes through its
// own haptic path (BellFeedback.ios.kt) independent of this away-detection.
actual fun isPageHidden(): Boolean = false

actual fun hasWindowFocus(): Boolean = true
