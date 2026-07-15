package com.tanyudii.tmuxweb.terminal

actual fun triggerBellFeedback() {
    // Coverage-only target (see composeApp/build.gradle.kts) — no real
    // desktop app ships from this target, so there's no bell UX to deliver.
}
