package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.domain.currentBrowserPushEndpoint
import com.tanyudii.tmuxweb.domain.isBrowserPushSupported
import com.tanyudii.tmuxweb.domain.model.PushSubscriptionPayload
import com.tanyudii.tmuxweb.domain.repository.PushNotificationRepository
import com.tanyudii.tmuxweb.domain.subscribeBrowserPush
import com.tanyudii.tmuxweb.domain.unsubscribeBrowserPush
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PushNotificationUiState(
    val isSupported: Boolean = false,
    val isEnabled: Boolean = false,
    val isBusy: Boolean = false,
    val errorMessage: String? = null,
)

/**
 * Drives the "Enable push notifications" toggle (see WebMainPane's TopBar)
 * -- subscribeBrowserPush/unsubscribeBrowserPush (domain/BrowserPush.kt) own
 * the actual browser interaction (service worker, Notification permission,
 * PushManager), this ViewModel just sequences them with the backend's
 * subscribe/unsubscribe calls and reflects the outcome as UI state.
 */
class PushNotificationViewModel(
    private val repository: PushNotificationRepository,
    private val scope: CoroutineScope,
    private val isBrowserPushSupported: () -> Boolean = ::isBrowserPushSupported,
    private val subscribeBrowserPush: suspend (String) -> PushSubscriptionPayload? = ::subscribeBrowserPush,
    private val unsubscribeBrowserPush: suspend () -> String? = ::unsubscribeBrowserPush,
    private val currentBrowserPushEndpoint: suspend () -> String? = ::currentBrowserPushEndpoint,
) {
    private val _state = MutableStateFlow(PushNotificationUiState(isSupported = isBrowserPushSupported()))
    val state: StateFlow<PushNotificationUiState> = _state.asStateFlow()

    init {
        if (_state.value.isSupported) {
            scope.launch {
                val endpoint = currentBrowserPushEndpoint()
                _state.update { it.copy(isEnabled = endpoint != null) }
            }
        }
    }

    fun toggle() {
        if (_state.value.isBusy) return
        if (_state.value.isEnabled) disable() else enable()
    }

    private fun enable() {
        _state.update { it.copy(isBusy = true, errorMessage = null) }
        scope.launch {
            runCatching {
                val publicKey = repository.getPublicKey()
                val subscription = subscribeBrowserPush(publicKey)
                    ?: error("Push notifications weren't enabled -- check your browser's notification permission.")
                repository.subscribe(subscription)
            }
                .onSuccess { _state.update { it.copy(isBusy = false, isEnabled = true) } }
                .onFailure { error -> _state.update { it.copy(isBusy = false, errorMessage = error.toUiMessage()) } }
        }
    }

    private fun disable() {
        _state.update { it.copy(isBusy = true, errorMessage = null) }
        scope.launch {
            runCatching {
                val endpoint = unsubscribeBrowserPush()
                if (endpoint != null) repository.unsubscribe(endpoint)
            }
                .onSuccess { _state.update { it.copy(isBusy = false, isEnabled = false) } }
                .onFailure { error -> _state.update { it.copy(isBusy = false, errorMessage = error.toUiMessage()) } }
        }
    }
}
