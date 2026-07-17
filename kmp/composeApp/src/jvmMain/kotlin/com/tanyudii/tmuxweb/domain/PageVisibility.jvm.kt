package com.tanyudii.tmuxweb.domain

// Coverage-only target (see composeApp/build.gradle.kts) -- no real desktop
// app ships from this target, so there's no real window to query.
actual fun isPageHidden(): Boolean = false

actual fun hasWindowFocus(): Boolean = true
