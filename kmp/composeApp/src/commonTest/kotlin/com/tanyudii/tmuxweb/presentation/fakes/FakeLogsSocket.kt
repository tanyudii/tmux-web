package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.data.remote.logs.LogsEvent
import com.tanyudii.tmuxweb.data.remote.logs.LogsSocket
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow

class FakeLogsSocket : LogsSocket {
    data class ConnectCall(val projectId: String, val sessionName: String, val service: String)

    val connectedCalls = mutableListOf<ConnectCall>()
    var closeCallCount = 0
    val events = MutableSharedFlow<LogsEvent>(extraBufferCapacity = 16)

    override fun connect(projectId: String, sessionName: String, service: String): Flow<LogsEvent> {
        connectedCalls.add(ConnectCall(projectId, sessionName, service))
        return events
    }

    override suspend fun close() {
        closeCallCount++
    }
}
