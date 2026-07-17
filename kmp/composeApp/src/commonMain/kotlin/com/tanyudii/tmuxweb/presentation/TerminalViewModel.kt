package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.terminal.ClientMessage
import com.tanyudii.tmuxweb.data.remote.terminal.TerminalEvent
import com.tanyudii.tmuxweb.data.remote.terminal.TerminalSocket
import com.tanyudii.tmuxweb.domain.shouldPlayBellAlert
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
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
    private var retryJob: Job? = null
    private var connectedSessionFullName: String? = null
    private var connectedPane: Int = 0
    private var lastBellAlertAt: Long? = null
    private var lastRequestedSize: Pair<Int, Int>? = null
    private var isManualDisconnect = false
    private var retryDelayMs = INITIAL_RETRY_DELAY_MS

    /** [pane] 0 is the primary session; 1 is the EMB-217 split viewport -- see TerminalSocket.connect. */
    fun connect(sessionFullName: String, pane: Int = 0) {
        isManualDisconnect = false
        connectedSessionFullName = sessionFullName
        connectedPane = pane
        retryJob?.cancel()
        connectionJob?.cancel()
        connectionJob = scope.launch {
            socket.connect(sessionFullName, pane).collect(::handleEvent)
        }
    }

    /**
     * Re-attaches to the same session (and pane) — iOS Safari (and the native app) suspends/closes
     * the socket while backgrounded, unlike a desktop tab. Also invoked automatically: see
     * [scheduleReconnect] for the unexpected-close retry loop, and `ObserveAppForeground` for the
     * foreground fast path.
     */
    fun reconnect() {
        connectedSessionFullName?.let { connect(it, connectedPane) }
    }

    fun disconnect() {
        isManualDisconnect = true
        retryJob?.cancel()
        connectionJob?.cancel()
        scope.launch { socket.close() }
    }

    fun onInput(text: String) {
        scope.launch { socket.send(ClientMessage.Input(text)) }
    }

    fun onResize(cols: Int, rows: Int) {
        if (cols <= 0 || rows <= 0) return
        lastRequestedSize = cols to rows
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
            is TerminalEvent.Opened -> {
                retryDelayMs = INITIAL_RETRY_DELAY_MS
                _state.update { it.copy(isConnected = true) }
                // TerminalSocket.send() (KtorTerminalSocket) silently no-ops
                // until its underlying WS session exists -- and the platform
                // terminal view's first fit()/resize typically fires at
                // mount time, well before this Opened event, so that first
                // resize is otherwise lost with no retry. Re-sending
                // whatever size we last know about here is what actually
                // gets the server (and therefore tmux) synced to the real
                // terminal size instead of staying at tmux's own default.
                lastRequestedSize?.let { (cols, rows) -> socket.send(ClientMessage.Resize(cols, rows)) }
            }
            is TerminalEvent.Output -> _output.emit(event.bytes)
            is TerminalEvent.Closed -> {
                _state.update { it.copy(isConnected = false) }
                scheduleReconnect()
            }
        }
    }

    // The socket can legitimately drop for reasons outside our control (iOS
    // Safari suspending/closing a backgrounded tab's WS being the motivating
    // case -- see reconnect()'s doc comment): without this, isConnected just
    // stays false forever and the "Reconnecting..." banner never resolves,
    // since nothing else re-invokes connect(). Capped exponential backoff
    // avoids hammering the server when it's genuinely down; the delay resets
    // to the initial value the moment a connection actually succeeds again
    // (see the Opened branch above).
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
        const val OUTPUT_BUFFER_CAPACITY = 64
        const val INITIAL_RETRY_DELAY_MS = 1000L
        const val MAX_RETRY_DELAY_MS = 10_000L
    }
}
