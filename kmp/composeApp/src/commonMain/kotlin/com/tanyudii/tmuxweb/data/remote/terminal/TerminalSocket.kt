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
    /** Opens the socket for one session; the returned flow completes when the socket closes. */
    fun connect(sessionFullName: String): Flow<TerminalEvent>

    suspend fun send(message: ClientMessage)

    suspend fun close()
}
