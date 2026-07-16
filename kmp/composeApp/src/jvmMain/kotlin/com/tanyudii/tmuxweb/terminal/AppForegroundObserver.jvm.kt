package com.tanyudii.tmuxweb.terminal

// Coverage-only target (see composeApp/build.gradle.kts) -- no real desktop
// app ships from this target, and no foreground/background concept applies.
actual fun observeAppForeground(onForeground: () -> Unit): () -> Unit = {}
