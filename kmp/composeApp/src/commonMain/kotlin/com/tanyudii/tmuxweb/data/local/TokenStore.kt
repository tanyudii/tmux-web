package com.tanyudii.tmuxweb.data.local

/**
 * Persists the shared server token (see plan §2.1/§3.4). Kept separate from
 * base-URL storage because the token is the secret half of the pair — iOS
 * stores it in the Keychain (device-only, no iCloud sync, mirroring today's
 * KeychainStore.swift exactly), Web stores it in `localStorage` (mirrors
 * app.js's `sessionStorage` use today, though `localStorage` survives tab
 * close — a deliberate improvement tracked for Phase 4, not a bug here).
 */
expect class TokenStore() {
    suspend fun saveToken(token: String)
    suspend fun loadToken(): String?
    suspend fun deleteToken()
}
