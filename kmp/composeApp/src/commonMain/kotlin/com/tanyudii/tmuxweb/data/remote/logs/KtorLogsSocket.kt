package com.tanyudii.tmuxweb.data.remote.logs

import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.http.URLBuilder
import io.ktor.http.URLProtocol
import io.ktor.http.encodedPath
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlinx.coroutines.channels.SendChannel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow

/**
 * Real `/ws/logs` connection — same `channelFlow` + Ktor `webSocket { }`
 * shape as [com.tanyudii.tmuxweb.data.remote.terminal.KtorTerminalSocket]
 * and for the exact same reason documented on that class: Ktor's
 * `webSocket { }` block runs on the HTTP engine's own dispatcher, a
 * different coroutine context than wherever `.collect()` is called from, so
 * a plain `flow { }` builder would crash with `IllegalStateException: Flow
 * invariant is violated` the moment a real frame arrives.
 *
 * Query params match `src/main.ts`'s `/ws/logs` upgrade handler exactly:
 * `project`, `session`, `service`, `token`. The server only ever sends
 * `Frame.Text` (src/log-stream.ts streams UTF-8 string chunks via
 * `ws.send(data: string)`, never binary), so unlike KtorTerminalSocket this
 * only handles one frame type.
 */
class KtorLogsSocket(
    private val httpClient: HttpClient,
    private val baseUrl: String,
    private val token: String,
) : LogsSocket {
    private var session: DefaultClientWebSocketSession? = null

    override fun connect(projectId: String, sessionName: String, service: String): Flow<LogsEvent> = channelFlow {
        val events: SendChannel<LogsEvent> = channel
        val wsUrl = buildWsUrl(projectId, sessionName, service)
        httpClient.webSocket(wsUrl) {
            session = this
            events.send(LogsEvent.Opened)
            runCatching { drainIncoming(this, events) }
                .onSuccess { events.send(LogsEvent.Closed(null)) }
                .onFailure { events.send(LogsEvent.Closed(it)) }
            session = null
        }
    }

    private suspend fun drainIncoming(
        wsSession: DefaultClientWebSocketSession,
        events: SendChannel<LogsEvent>,
    ) {
        for (frame in wsSession.incoming) {
            when (frame) {
                is Frame.Text -> events.send(LogsEvent.Output(frame.readText()))
                else -> Unit
            }
        }
    }

    override suspend fun close() {
        session?.close()
        session = null
    }

    private fun buildWsUrl(projectId: String, sessionName: String, service: String): String {
        val builder = URLBuilder(baseUrl)
        builder.protocol = if (builder.protocol == URLProtocol.HTTPS) URLProtocol.WSS else URLProtocol.WS
        builder.encodedPath = "/ws/logs"
        builder.parameters.append("project", projectId)
        builder.parameters.append("session", sessionName)
        builder.parameters.append("service", service)
        builder.parameters.append("token", token)
        return builder.buildString()
    }
}
