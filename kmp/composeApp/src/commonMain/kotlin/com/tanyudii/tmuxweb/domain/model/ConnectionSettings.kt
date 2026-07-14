package com.tanyudii.tmuxweb.domain.model

/**
 * Mirrors Swift's `ConnectionSettings` — the server URL is not a secret
 * (UserDefaults/localStorage), the token is (Keychain).
 */
data class ConnectionSettings(val baseUrl: String, val token: String)
