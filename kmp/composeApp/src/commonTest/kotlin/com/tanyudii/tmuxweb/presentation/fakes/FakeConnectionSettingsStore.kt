package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.domain.model.ConnectionSettings
import com.tanyudii.tmuxweb.domain.repository.ConnectionSettingsStore

class FakeConnectionSettingsStore(private var current: ConnectionSettings? = null) : ConnectionSettingsStore {
    var saveCallCount = 0
    var clearCallCount = 0

    override suspend fun load(): ConnectionSettings? = current

    override suspend fun save(baseUrl: String, token: String) {
        saveCallCount++
        current = ConnectionSettings(baseUrl, token)
    }

    override suspend fun clear() {
        clearCallCount++
        current = null
    }
}
