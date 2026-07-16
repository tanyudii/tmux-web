package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.logs.LogsEvent
import com.tanyudii.tmuxweb.data.remote.logs.LogsSocket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Raw chunks in arrival order, not discrete lines -- docker's stdout/stderr
 * interleaving means a "line" can arrive split across chunks, so splitting
 * on `\n` is a UI-render concern for [com.tanyudii.tmuxweb.ui.components.TmuxLogsDialog],
 * not a state concern here.
 */
data class LogsUiState(
    val lines: List<String> = emptyList(),
    val isConnected: Boolean = false,
    val errorMessage: String? = null,
)

/**
 * Streams `/ws/logs` output for one docker-compose service -- mirrors
 * [EnvironmentViewModel]'s constructor-launches-immediately pattern so the
 * composable layer can `remember(projectId, sessionName, service) { LogsViewModel(...) }`
 * and have it auto-recreate when the selected service changes.
 */
class LogsViewModel(
    private val projectId: String,
    private val sessionName: String,
    service: String,
    private val socket: LogsSocket,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(LogsUiState())
    val state: StateFlow<LogsUiState> = _state.asStateFlow()

    private var connectionJob: Job? = null
    private var retryJob: Job? = null
    private var connectedService: String = service
    private var isManualDisconnect = false
    private var retryDelayMs = INITIAL_RETRY_DELAY_MS

    init {
        connect(service)
    }

    /** Closes the current socket and reconnects to [newService] with a fresh (empty) buffer. */
    fun switchService(newService: String) {
        isManualDisconnect = true
        retryJob?.cancel()
        connectionJob?.cancel()
        _state.update { LogsUiState() }
        scope.launch { socket.close() }
        connect(newService)
    }

    /** Disposes the underlying socket -- for `DisposableEffect` cleanup on the Compose side. */
    fun close() {
        isManualDisconnect = true
        retryJob?.cancel()
        connectionJob?.cancel()
        scope.launch { socket.close() }
    }

    /** Re-attaches to the same service -- see [TerminalViewModel.reconnect]'s doc comment for why. */
    fun reconnect() {
        connect(connectedService)
    }

    private fun connect(service: String) {
        isManualDisconnect = false
        connectedService = service
        connectionJob = scope.launch {
            socket.connect(projectId, sessionName, service).collect { event ->
                when (event) {
                    is LogsEvent.Output -> _state.update { it.copy(lines = it.lines + event.text) }
                    is LogsEvent.Opened -> {
                        retryDelayMs = INITIAL_RETRY_DELAY_MS
                        _state.update { it.copy(isConnected = true) }
                    }
                    is LogsEvent.Closed -> {
                        _state.update { it.copy(isConnected = false, errorMessage = event.cause?.message) }
                        scheduleReconnect()
                    }
                }
            }
        }
    }

    // See TerminalViewModel.scheduleReconnect's comment -- same rationale (iOS Safari
    // suspending/closing a backgrounded tab's socket) applies to the logs socket.
    private fun scheduleReconnect() {
        if (isManualDisconnect) return
        val delayMs = retryDelayMs
        retryDelayMs = (retryDelayMs * 2).coerceAtMost(MAX_RETRY_DELAY_MS)
        retryJob = scope.launch {
            delay(delayMs)
            reconnect()
        }
    }

    private companion object {
        const val INITIAL_RETRY_DELAY_MS = 1000L
        const val MAX_RETRY_DELAY_MS = 10_000L
    }
}
