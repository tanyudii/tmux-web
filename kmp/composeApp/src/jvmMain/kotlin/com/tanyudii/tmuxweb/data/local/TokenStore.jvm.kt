package com.tanyudii.tmuxweb.data.local

// JVM actual exists only so Kover has commonMain bytecode to instrument (see
// composeApp/build.gradle.kts) — this target ships no real desktop app, so a
// simple in-memory store (not real persistence) is sufficient.
actual class TokenStore actual constructor() {
    private var token: String? = null

    actual suspend fun saveToken(token: String) {
        this.token = token
    }

    actual suspend fun loadToken(): String? = token

    actual suspend fun deleteToken() {
        token = null
    }
}
