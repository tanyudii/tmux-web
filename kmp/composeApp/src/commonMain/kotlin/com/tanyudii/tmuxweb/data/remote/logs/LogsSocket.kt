package com.tanyudii.tmuxweb.data.remote.logs

import kotlinx.coroutines.flow.Flow

/** Events the `/ws/logs` socket surfaces upward — see TerminalEvent.kt's mirror for `/ws`. */
sealed class LogsEvent {
    data class Output(val text: String) : LogsEvent()

    data object Opened : LogsEvent()

    data class Closed(val cause: Throwable?) : LogsEvent()
}

/**
 * Abstraction over the `/ws/logs` socket (mirrors
 * [com.tanyudii.tmuxweb.data.remote.terminal.TerminalSocket]), kept separate
 * so tests can substitute a fake. Read-only — src/log-stream.ts's
 * `attachLogsToSocket` never reads from the socket, so unlike
 * `TerminalSocket` there is no `send()`.
 */
interface LogsSocket {
    /** Opens the socket for one service's log tail; the returned flow completes when the socket closes. */
    fun connect(projectId: String, sessionName: String, service: String): Flow<LogsEvent>

    suspend fun close()
}
