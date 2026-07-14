package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.data.remote.terminal.ClientMessage
import com.tanyudii.tmuxweb.data.remote.terminal.TerminalEvent
import com.tanyudii.tmuxweb.data.remote.terminal.TerminalSocket
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow

class FakeTerminalSocket : TerminalSocket {
    val connectedSessions = mutableListOf<String>()
    val sentMessages = mutableListOf<ClientMessage>()
    var closeCallCount = 0
    val events = MutableSharedFlow<TerminalEvent>(extraBufferCapacity = 16)

    override fun connect(sessionFullName: String): Flow<TerminalEvent> {
        connectedSessions.add(sessionFullName)
        return events
    }

    override suspend fun send(message: ClientMessage) {
        sentMessages.add(message)
    }

    override suspend fun close() {
        closeCallCount++
    }
}
