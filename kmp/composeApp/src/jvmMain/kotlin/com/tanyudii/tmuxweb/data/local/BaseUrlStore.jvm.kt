package com.tanyudii.tmuxweb.data.local

// JVM actual exists only so Kover has commonMain bytecode to instrument (see
// composeApp/build.gradle.kts) — this target ships no real desktop app, so a
// simple in-memory store (not real persistence) is sufficient.
actual class BaseUrlStore actual constructor() {
    private var baseUrl: String? = null

    actual suspend fun saveBaseUrl(baseUrl: String) {
        this.baseUrl = baseUrl
    }

    actual suspend fun loadBaseUrl(): String? = baseUrl

    actual suspend fun deleteBaseUrl() {
        baseUrl = null
    }
}
