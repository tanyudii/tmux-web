package com.tanyudii.tmuxweb.presentation

import app.cash.turbine.test
import com.tanyudii.tmuxweb.data.remote.terminal.ClientMessage
import com.tanyudii.tmuxweb.data.remote.terminal.TerminalEvent
import com.tanyudii.tmuxweb.domain.BELL_COOLDOWN_MS
import com.tanyudii.tmuxweb.presentation.fakes.FakeTerminalSocket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Ports TerminalSocket.swift's connect/resize/receive-loop behavior and public/notify.js's bell cooldown. */
class TerminalViewModelTest {
    // Shares runTest's own virtual-time scheduler (not a fresh independent one) --
    // required so advanceTimeBy/advanceUntilIdle below actually drive the
    // scheduleReconnect()'s delay(), instead of it hanging forever on an
    // unrelated scheduler nothing ever advances.
    private fun TestScope.viewModel(socket: FakeTerminalSocket): TerminalViewModel {
        val scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler))
        return TerminalViewModel(socket, scope)
    }

    @Test
    fun `connect opens the socket for the given session`() = runTest {
        val socket = FakeTerminalSocket()

        viewModel(socket).connect("proj__main")

        assertEquals(listOf("proj__main"), socket.connectedSessions)
    }

    @Test
    fun `opened event marks the connection as connected`() = runTest {
        val socket = FakeTerminalSocket()
        val viewModel = viewModel(socket)
        viewModel.connect("proj__main")

        socket.events.emit(TerminalEvent.Opened)

        assertTrue(viewModel.state.value.isConnected)
    }

    @Test
    fun `closed event marks the connection as disconnected`() = runTest {
        val socket = FakeTerminalSocket()
        val viewModel = viewModel(socket)
        viewModel.connect("proj__main")

        socket.events.emit(TerminalEvent.Closed(null))

        assertFalse(viewModel.state.value.isConnected)
    }

    @Test
    fun `output events are forwarded to the output flow`() = runTest {
        val socket = FakeTerminalSocket()
        val viewModel = viewModel(socket)
        viewModel.connect("proj__main")

        viewModel.output.test {
            socket.events.emit(TerminalEvent.Output(byteArrayOf(1, 2, 3)))
            assertContentEquals(byteArrayOf(1, 2, 3), awaitItem())
        }
    }

    @Test
    fun `onInput sends an Input message`() = runTest {
        val socket = FakeTerminalSocket()
        viewModel(socket).onInput("ls\n")

        val expected: List<ClientMessage> = listOf(ClientMessage.Input("ls\n"))
        assertEquals(expected, socket.sentMessages)
    }

    @Test
    fun `onResize sends a Resize message for positive dimensions`() = runTest {
        val socket = FakeTerminalSocket()
        viewModel(socket).onResize(120, 40)

        val expected: List<ClientMessage> = listOf(ClientMessage.Resize(120, 40))
        assertEquals(expected, socket.sentMessages)
    }

    @Test
    fun `onResize drops non-positive dimensions instead of sending garbage`() = runTest {
        val socket = FakeTerminalSocket()
        val viewModel = viewModel(socket)

        viewModel.onResize(0, 40)
        viewModel.onResize(120, -1)

        assertTrue(socket.sentMessages.isEmpty())
    }

    @Test
    fun `a resize sent before the socket opens is retransmitted once it does`() = runTest {
        // PlatformTerminalView's initial fit() fires onResize essentially at
        // mount time, which can easily race ahead of the WS handshake --
        // KtorTerminalSocket.send() silently no-ops while its session is
        // still null, so without this retransmit the server (and therefore
        // tmux) would never learn the real terminal size at all.
        val socket = FakeTerminalSocket()
        val viewModel = viewModel(socket)
        viewModel.connect("proj__main")

        viewModel.onResize(120, 40)
        socket.events.emit(TerminalEvent.Opened)

        val expected: List<ClientMessage> = listOf(ClientMessage.Resize(120, 40), ClientMessage.Resize(120, 40))
        assertEquals(expected, socket.sentMessages)
    }

    @Test
    fun `opened event with no prior resize does not send a spurious resize`() = runTest {
        val socket = FakeTerminalSocket()
        val viewModel = viewModel(socket)
        viewModel.connect("proj__main")

        socket.events.emit(TerminalEvent.Opened)

        assertTrue(socket.sentMessages.isEmpty())
    }

    @Test
    fun `onScroll sends a Scroll message for positive line counts`() = runTest {
        val socket = FakeTerminalSocket()
        viewModel(socket).onScroll(ClientMessage.ScrollDirection.UP, 3)

        val expected: List<ClientMessage> = listOf(ClientMessage.Scroll(ClientMessage.ScrollDirection.UP, 3))
        assertEquals(expected, socket.sentMessages)
    }

    @Test
    fun `disconnect cancels the connection and closes the socket`() = runTest {
        val socket = FakeTerminalSocket()
        val viewModel = viewModel(socket)
        viewModel.connect("proj__main")

        viewModel.disconnect()

        assertEquals(1, socket.closeCallCount)
    }

    @Test
    fun `reconnect reopens the same session`() = runTest {
        val socket = FakeTerminalSocket()
        val viewModel = viewModel(socket)
        viewModel.connect("proj__main")

        viewModel.reconnect()

        assertEquals(listOf("proj__main", "proj__main"), socket.connectedSessions)
    }

    @Test
    fun `an unexpected close automatically reconnects after the backoff delay`() = runTest {
        val socket = FakeTerminalSocket()
        val viewModel = viewModel(socket)
        viewModel.connect("proj__main")

        socket.events.emit(TerminalEvent.Closed(RuntimeException("dropped")))
        advanceUntilIdle()

        assertEquals(listOf("proj__main", "proj__main"), socket.connectedSessions)
    }

    @Test
    fun `disconnect does not schedule an automatic reconnect`() = runTest {
        val socket = FakeTerminalSocket()
        val viewModel = viewModel(socket)
        viewModel.connect("proj__main")

        viewModel.disconnect()
        advanceUntilIdle()

        assertEquals(listOf("proj__main"), socket.connectedSessions)
    }

    @Test
    fun `repeated unexpected closes back off exponentially before each reconnect`() = runTest {
        val socket = FakeTerminalSocket()
        val viewModel = viewModel(socket)
        viewModel.connect("proj__main")

        socket.events.emit(TerminalEvent.Closed(null))
        advanceTimeBy(999)
        assertEquals(listOf("proj__main"), socket.connectedSessions)
        advanceTimeBy(2)
        assertEquals(listOf("proj__main", "proj__main"), socket.connectedSessions)

        socket.events.emit(TerminalEvent.Closed(null))
        advanceTimeBy(1999)
        assertEquals(listOf("proj__main", "proj__main"), socket.connectedSessions)
        advanceTimeBy(2)
        assertEquals(listOf("proj__main", "proj__main", "proj__main"), socket.connectedSessions)
    }

    @Test
    fun `a successful reconnect resets the backoff delay to its initial value`() = runTest {
        val socket = FakeTerminalSocket()
        val viewModel = viewModel(socket)
        viewModel.connect("proj__main")

        socket.events.emit(TerminalEvent.Closed(null))
        advanceUntilIdle()
        socket.events.emit(TerminalEvent.Opened)

        socket.events.emit(TerminalEvent.Closed(null))
        advanceTimeBy(999)
        assertEquals(listOf("proj__main", "proj__main"), socket.connectedSessions)
        advanceTimeBy(2)
        assertEquals(listOf("proj__main", "proj__main", "proj__main"), socket.connectedSessions)
    }

    @Test
    fun `first bell while away always alerts`() = runTest {
        val viewModel = viewModel(FakeTerminalSocket())

        val alerted = viewModel.onBell(muted = false, hasFocus = false, hidden = true, now = 1000L)

        assertTrue(alerted)
    }

    @Test
    fun `second bell within cooldown is suppressed`() = runTest {
        val viewModel = viewModel(FakeTerminalSocket())
        viewModel.onBell(muted = false, hasFocus = false, hidden = true, now = 1000L)

        val alerted =
            viewModel.onBell(muted = false, hasFocus = false, hidden = true, now = 1000L + BELL_COOLDOWN_MS - 1)

        assertFalse(alerted)
    }

    @Test
    fun `bell after cooldown elapses alerts again`() = runTest {
        val viewModel = viewModel(FakeTerminalSocket())
        viewModel.onBell(muted = false, hasFocus = false, hidden = true, now = 1000L)

        val alerted = viewModel.onBell(muted = false, hasFocus = false, hidden = true, now = 1000L + BELL_COOLDOWN_MS)

        assertTrue(alerted)
    }
}
