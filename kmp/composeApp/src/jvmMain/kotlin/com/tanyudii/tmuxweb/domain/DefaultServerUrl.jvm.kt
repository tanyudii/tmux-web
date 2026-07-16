package com.tanyudii.tmuxweb.domain

// No "URL the app was accessed from" concept on this target (see
// BaseUrlStore.jvm.kt -- this target ships no real desktop app).
actual fun defaultServerUrl(): String? = null
