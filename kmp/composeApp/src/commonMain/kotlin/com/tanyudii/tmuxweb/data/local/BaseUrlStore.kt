package com.tanyudii.tmuxweb.data.local

/**
 * Persists the server base URL — see plan §3.4: "the surface area is tiny
 * (two values: token, base URL)... base URL is non-secret (mirrors today's
 * `UserDefaults` split)." Kept separate from [TokenStore] because it needs
 * no Keychain-grade protection, unlike the shared server token.
 */
expect class BaseUrlStore() {
    suspend fun saveBaseUrl(baseUrl: String)
    suspend fun loadBaseUrl(): String?
    suspend fun deleteBaseUrl()
}
