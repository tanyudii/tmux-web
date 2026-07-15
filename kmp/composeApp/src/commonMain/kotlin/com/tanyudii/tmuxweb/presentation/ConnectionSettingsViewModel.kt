package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ConnectionTester
import com.tanyudii.tmuxweb.domain.model.ConnectionSettings
import com.tanyudii.tmuxweb.domain.parseServerUrl
import com.tanyudii.tmuxweb.domain.repository.ConnectionSettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Ports ConnectionSettingsView.swift's `@State` machine 1:1 — see plan §3.4. */
data class ConnectionSettingsUiState(
    val serverUrlText: String = "http://",
    val token: String = "",
    val isTesting: Boolean = false,
    val errorMessage: String? = null,
    val current: ConnectionSettings? = null,
    // Distinguishes "not loaded yet" from "loaded, nothing saved" — App()
    // needs this to avoid flashing the Settings screen for a frame while
    // settingsStore.load() is still resolving.
    val isLoaded: Boolean = false,
) {
    val canSubmit: Boolean get() = !isTesting && serverUrlText.isNotEmpty() && token.isNotEmpty()
}

class ConnectionSettingsViewModel(
    private val settingsStore: ConnectionSettingsStore,
    private val connectionTester: ConnectionTester,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(ConnectionSettingsUiState())
    val state: StateFlow<ConnectionSettingsUiState> = _state.asStateFlow()

    init {
        scope.launch {
            val current = settingsStore.load()
            _state.update { it.copy(current = current, isLoaded = true) }
        }
    }

    fun updateServerUrlText(text: String) {
        _state.update { it.copy(serverUrlText = text) }
    }

    fun updateToken(text: String) {
        _state.update { it.copy(token = text) }
    }

    fun testAndSave() {
        val urlText = _state.value.serverUrlText
        val token = _state.value.token
        val normalizedUrl = parseServerUrl(urlText)
        if (normalizedUrl == null) {
            _state.update { it.copy(errorMessage = "Invalid server URL.") }
            return
        }

        scope.launch {
            _state.update { it.copy(isTesting = true, errorMessage = null) }
            runSuspendCatching { connectionTester.test(normalizedUrl, token) }
                .onSuccess {
                    settingsStore.save(normalizedUrl, token)
                    _state.update { it.copy(isTesting = false, current = ConnectionSettings(normalizedUrl, token)) }
                }
                .onFailure { error -> _state.update { it.copy(isTesting = false, errorMessage = error.toUiMessage()) } }
        }
    }

    fun clear() {
        scope.launch {
            settingsStore.clear()
            // isLoaded stays true: "Switch Server" should land straight on
            // the Settings screen, not flash App()'s not-loaded-yet spinner.
            _state.update { ConnectionSettingsUiState(isLoaded = true) }
        }
    }
}
