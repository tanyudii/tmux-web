package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.terminal.ClientMessage
import com.tanyudii.tmuxweb.data.remote.terminal.TerminalEvent
import com.tanyudii.tmuxweb.data.remote.terminal.TerminalSocket
import com.tanyudii.tmuxweb.domain.shouldPlayBellAlert
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Owns the `/ws` terminal socket lifecycle — connect/reconnect/disconnect,
 * outbound input/resize/scroll, inbound raw PTY bytes, and the bell-alert
 * cooldown. The platform terminal widget (SwiftTerm/xterm.js, see
 * PlatformTerminalView expect/actual) is a dumb I/O surface: it forwards
 * keystrokes/resizes/bell events up through this ViewModel and receives raw
 * bytes back down through [output] — see TerminalSocket.swift/public/app.js
 * for the behavior being ported. Unlike Swift's TerminalContainerView, title
 * text is not modeled here: it's a pure widget -> UI passthrough with no
 * business logic, so it stays local Composable state.
 */
data class TerminalUiState(val isConnected: Boolean = true)

class TerminalViewModel(
    private val socket: TerminalSocket,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(TerminalUiState())
    val state: StateFlow<TerminalUiState> = _state.asStateFlow()

    private val _output = MutableSharedFlow<ByteArray>(extraBufferCapacity = OUTPUT_BUFFER_CAPACITY)
    val output: SharedFlow<ByteArray> = _output.asSharedFlow()

    private var connectionJob: Job? = null
    private var connectedSessionFullName: String? = null
    private var lastBellAlertAt: Long? = null

    fun connect(sessionFullName: String) {
        connectedSessionFullName = sessionFullName
        connectionJob?.cancel()
        connectionJob = scope.launch {
            socket.connect(sessionFullName).collect(::handleEvent)
        }
    }

    /** Re-attaches to the same session — iOS suspends the socket while backgrounded, see TerminalSocket.swift. */
    fun reconnect() {
        connectedSessionFullName?.let(::connect)
    }

    fun disconnect() {
        connectionJob?.cancel()
        scope.launch { socket.close() }
    }

    fun onInput(text: String) {
        scope.launch { socket.send(ClientMessage.Input(text)) }
    }

    fun onResize(cols: Int, rows: Int) {
        if (cols <= 0 || rows <= 0) return
        scope.launch { socket.send(ClientMessage.Resize(cols, rows)) }
    }

    fun onScroll(direction: ClientMessage.ScrollDirection, lines: Int) {
        if (lines <= 0) return
        scope.launch { socket.send(ClientMessage.Scroll(direction, lines)) }
    }

    /**
     * Called every time the terminal widget's native delegate fires a bell.
     * Returns whether the platform should actually deliver an alert (iOS:
     * haptic + local notification; Web: title flash + beep + `Notification`)
     * — see plan §2.6's bell-alert unification and public/notify.js.
     */
    fun onBell(muted: Boolean, hasFocus: Boolean, hidden: Boolean, now: Long): Boolean {
        val shouldAlert = shouldPlayBellAlert(muted, hasFocus, hidden, lastBellAlertAt, now)
        if (shouldAlert) lastBellAlertAt = now
        return shouldAlert
    }

    private suspend fun handleEvent(event: TerminalEvent) {
        when (event) {
            is TerminalEvent.Opened -> _state.update { it.copy(isConnected = true) }
            is TerminalEvent.Output -> _output.emit(event.bytes)
            is TerminalEvent.Closed -> _state.update { it.copy(isConnected = false) }
        }
    }

    private companion object {
        const val OUTPUT_BUFFER_CAPACITY = 64
    }
}
