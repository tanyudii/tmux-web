package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.domain.model.EnvStatus
import com.tanyudii.tmuxweb.domain.repository.EnvironmentRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Ports EnvironmentBar.swift's 3s poll loop + setup/stop/logs state machine —
 * see plan §2.6's poll-interval table and the "Per-session environments"
 * feature-parity item.
 */
data class EnvironmentUiState(
    val status: EnvStatus? = null,
    val isBusy: Boolean = false,
    val errorMessage: String? = null,
    val isShowingStopConfirm: Boolean = false,
    val logsService: String? = null,
)

class EnvironmentViewModel(
    private val projectId: String,
    private val sessionName: String,
    private val repository: EnvironmentRepository,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(EnvironmentUiState())
    val state: StateFlow<EnvironmentUiState> = _state.asStateFlow()

    init {
        scope.launch {
            while (isActive) {
                refresh()
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    fun requestStop() {
        _state.update { it.copy(isShowingStopConfirm = true) }
    }

    fun cancelStop() {
        _state.update { it.copy(isShowingStopConfirm = false) }
    }

    fun setup() {
        scope.launch {
            _state.update { it.copy(isBusy = true) }
            runSuspendCatching { repository.startEnv(projectId, sessionName) }
                .onSuccess { refresh() }
                .onFailure { error -> _state.update { it.copy(errorMessage = error.toUiMessage()) } }
            _state.update { it.copy(isBusy = false) }
        }
    }

    /** Cancels an in-flight setup() -- see EMB-209. No isBusy gate: unlike setup()/stop(), this doesn't
     *  start a new mutation, it just asks the server to abort the one already running. */
    fun cancel() {
        scope.launch {
            runSuspendCatching { repository.cancelEnv(projectId, sessionName) }
                .onSuccess { refresh() }
                .onFailure { error -> _state.update { it.copy(errorMessage = error.toUiMessage()) } }
        }
    }

    fun stop() {
        _state.update { it.copy(isShowingStopConfirm = false, isBusy = true) }
        scope.launch {
            runSuspendCatching { repository.stopEnv(projectId, sessionName) }
                .onSuccess { refresh() }
                .onFailure { error -> _state.update { it.copy(errorMessage = error.toUiMessage()) } }
            _state.update { it.copy(isBusy = false) }
        }
    }

    fun showLogs(service: String) {
        _state.update { it.copy(logsService = service) }
    }

    fun switchLogsService(service: String) {
        _state.update { it.copy(logsService = service) }
    }

    fun hideLogs() {
        _state.update { it.copy(logsService = null) }
    }

    fun dismissError() {
        _state.update { it.copy(errorMessage = null) }
    }

    /** Silent on poll failure — avoid popping an alert every 3s on a transient hiccup; see EnvironmentBar.swift. */
    private suspend fun refresh() {
        runSuspendCatching { repository.envStatus(projectId, sessionName) }
            .onSuccess { status -> _state.update { it.copy(status = status) } }
    }

    private companion object {
        const val POLL_INTERVAL_MS = 3000L
    }
}
