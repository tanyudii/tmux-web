package com.tanyudii.tmuxweb.terminal

@Suppress("UnusedParameter")
actual fun triggerBellFeedback(title: String) {
    // Coverage-only target (see composeApp/build.gradle.kts) — no real
    // desktop app ships from this target, so there's no bell UX to deliver.
}
