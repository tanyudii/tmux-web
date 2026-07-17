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
import kotlinx.coroutines.channels.SendChannel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow

/**
 * Real `/ws` connection — same upgrade path and query params as
 * TerminalSocket.swift's `connect(info:)`: token as `?token=` (browsers/iOS
 * both use this, not a header, per plan §2.1), raw frame bytes fed straight
 * through with no additional framing (src/pty-bridge.ts streams raw PTY
 * output). Ktor client engine is resolved per-platform (darwin/js) exactly
 * like [com.tanyudii.tmuxweb.data.remote.HttpClientFactory] — no expect/actual needed here either.
 *
 * Built with `channelFlow`, not a plain `flow { }` builder: Ktor's
 * `webSocket { }` block runs the session on the HTTP engine's own dispatcher
 * — a different coroutine context than wherever `.collect()` is called from
 * (TerminalViewModel's Compose-scoped coroutine). A plain `flow { }` enforces
 * same-context emit/collect and crashes with `IllegalStateException: Flow
 * invariant is violated` the moment a real frame arrives; `channelFlow`
 * backs emission with a channel, which is safe across coroutine contexts.
 */
class KtorTerminalSocket(
    private val httpClient: HttpClient,
    private val baseUrl: String,
    private val token: String,
) : TerminalSocket {
    private var session: DefaultClientWebSocketSession? = null

    override fun connect(sessionFullName: String, pane: Int): Flow<TerminalEvent> = channelFlow {
        val events: SendChannel<TerminalEvent> = channel
        val wsUrl = buildWsUrl(sessionFullName, pane)
        httpClient.webSocket(wsUrl) {
            session = this
            events.send(TerminalEvent.Opened)
            runCatching { drainIncoming(this, events) }
                .onSuccess { events.send(TerminalEvent.Closed(null)) }
                .onFailure { events.send(TerminalEvent.Closed(it)) }
            session = null
        }
    }

    private suspend fun drainIncoming(
        wsSession: DefaultClientWebSocketSession,
        events: SendChannel<TerminalEvent>,
    ) {
        for (frame in wsSession.incoming) {
            when (frame) {
                is Frame.Binary -> events.send(TerminalEvent.Output(frame.readBytes()))
                is Frame.Text -> events.send(TerminalEvent.Output(frame.readBytes()))
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

    private fun buildWsUrl(sessionFullName: String, pane: Int): String {
        val builder = URLBuilder(baseUrl)
        builder.protocol = if (builder.protocol == URLProtocol.HTTPS) URLProtocol.WSS else URLProtocol.WS
        builder.encodedPath = "/ws"
        builder.parameters.append("session", sessionFullName)
        builder.parameters.append("token", token)
        if (pane != 0) builder.parameters.append("pane", pane.toString())
        return builder.buildString()
    }
}
