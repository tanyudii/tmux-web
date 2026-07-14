package com.tanyudii.tmuxweb.data.remote

import io.ktor.client.HttpClient
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/**
 * Ktor auto-selects the platform engine from what's on the classpath —
 * `ktor-client-darwin` on iOS, `ktor-client-js` on wasmJs (see plan §3.0/§3.5
 * and ADR 0002's Ktor research notes) — so this factory needs no expect/actual.
 *
 * `ignoreUnknownKeys = true` matters here: several server responses carry
 * fields our DTOs intentionally don't model yet (e.g. the session-creation
 * 202 body includes a `phase` field alongside `name`/`fullName` that
 * `PendingSessionCreation` doesn't need) — the backend is a frozen contract
 * we don't control, so being strict here would break on its harmless additions.
 */
fun createTmuxWebHttpClient(): HttpClient = HttpClient {
    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true })
    }
    install(WebSockets)
}
