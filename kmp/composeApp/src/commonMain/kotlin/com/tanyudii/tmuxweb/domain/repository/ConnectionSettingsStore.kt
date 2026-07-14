package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.local.BaseUrlStore
import com.tanyudii.tmuxweb.data.local.TokenStore
import com.tanyudii.tmuxweb.domain.model.ConnectionSettings

/** Ports ConnectionSettingsStore.swift's `save`/`clear`/`load` — same repository-interface pattern as Phase 2. */
interface ConnectionSettingsStore {
    suspend fun load(): ConnectionSettings?
    suspend fun save(baseUrl: String, token: String)
    suspend fun clear()
}

class DefaultConnectionSettingsStore(
    private val tokenStore: TokenStore,
    private val baseUrlStore: BaseUrlStore,
) : ConnectionSettingsStore {
    override suspend fun load(): ConnectionSettings? {
        val baseUrl = baseUrlStore.loadBaseUrl() ?: return null
        val token = tokenStore.loadToken() ?: return null
        return ConnectionSettings(baseUrl, token)
    }

    override suspend fun save(baseUrl: String, token: String) {
        baseUrlStore.saveBaseUrl(baseUrl)
        tokenStore.saveToken(token)
    }

    override suspend fun clear() {
        baseUrlStore.deleteBaseUrl()
        tokenStore.deleteToken()
    }
}
