package com.tanyudii.tmuxweb.data.remote.terminal

import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.http.URLBuilder
import io.ktor.http.URLProtocol
import io.ktor.http.encodedPath
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readBytes
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.flow

/**
 * Real `/ws` connection — same upgrade path and query params as
 * TerminalSocket.swift's `connect(info:)`: token as `?token=` (browsers/iOS
 * both use this, not a header, per plan §2.1), raw frame bytes fed straight
 * through with no additional framing (src/pty-bridge.ts streams raw PTY
 * output). Ktor client engine is resolved per-platform (darwin/js) exactly
 * like [com.tanyudii.tmuxweb.data.remote.HttpClientFactory] — no expect/actual needed here either.
 */
class KtorTerminalSocket(
    private val httpClient: HttpClient,
    private val baseUrl: String,
    private val token: String,
) : TerminalSocket {
    private var session: DefaultClientWebSocketSession? = null

    override fun connect(sessionFullName: String): Flow<TerminalEvent> = flow {
        val wsUrl = buildWsUrl(sessionFullName)
        httpClient.webSocket(wsUrl) {
            session = this
            emit(TerminalEvent.Opened)
            runCatching { drainIncoming(this) }
                .onSuccess { emit(TerminalEvent.Closed(null)) }
                .onFailure { emit(TerminalEvent.Closed(it)) }
            session = null
        }
    }

    private suspend fun FlowCollector<TerminalEvent>.drainIncoming(
        wsSession: DefaultClientWebSocketSession,
    ) {
        for (frame in wsSession.incoming) {
            when (frame) {
                is Frame.Binary -> emit(TerminalEvent.Output(frame.readBytes()))
                is Frame.Text -> emit(TerminalEvent.Output(frame.readBytes()))
                else -> Unit
            }
        }
    }

    override suspend fun send(message: ClientMessage) {
        session?.send(Frame.Text(message.encode()))
    }

    override suspend fun close() {
        session?.close()
        session = null
    }

    private fun buildWsUrl(sessionFullName: String): String {
        val builder = URLBuilder(baseUrl)
        builder.protocol = if (builder.protocol == URLProtocol.HTTPS) URLProtocol.WSS else URLProtocol.WS
        builder.encodedPath = "/ws"
        builder.parameters.append("session", sessionFullName)
        builder.parameters.append("token", token)
        return builder.buildString()
    }
}
