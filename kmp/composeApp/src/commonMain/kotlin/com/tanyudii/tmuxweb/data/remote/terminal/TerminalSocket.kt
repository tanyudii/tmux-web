package com.tanyudii.tmuxweb.data.remote.terminal

import kotlinx.coroutines.flow.Flow

/** Events the `/ws` terminal socket surfaces upward — see ClientMessage.kt for the reverse direction. */
sealed class TerminalEvent {
    data class Output(val bytes: ByteArray) : TerminalEvent()

    data object Opened : TerminalEvent()

    data class Closed(val cause: Throwable?) : TerminalEvent()
}

/**
 * Abstraction over the `/ws` terminal socket (mirrors TerminalSocket.swift /
 * public/app.js's `socket`), kept separate from [TerminalViewModel] so tests
 * can substitute a fake instead of opening a real network connection — same
 * repository-interface pattern as Phase 2's [com.tanyudii.tmuxweb.domain.repository].
 */
interface TerminalSocket {
    /**
     * Opens the socket for one session; the returned flow completes when the
     * socket closes. [pane] 0 (default) attaches to the primary session;
     * pane 1 attaches to the EMB-217 split viewport's linked tmux session
     * instead (see server.ts's /ws handler + session-naming.ts's
     * splitPaneSessionName) -- a fully independent client with its own
     * current-window, sharing the same underlying windows/panes as pane 0.
     */
    fun connect(sessionFullName: String, pane: Int = 0): Flow<TerminalEvent>

    suspend fun send(message: ClientMessage)

    suspend fun close()
}
