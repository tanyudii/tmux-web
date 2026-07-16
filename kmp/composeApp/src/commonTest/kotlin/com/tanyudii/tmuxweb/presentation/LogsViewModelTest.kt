package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.logs.LogsEvent
import com.tanyudii.tmuxweb.presentation.fakes.FakeLogsSocket
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Streams `/ws/logs` events into [LogsUiState] — mirrors
 * [EnvironmentViewModelTest]'s TestScope/backgroundScope/runCurrent idiom
 * since the underlying socket connection is also a never-ending collector.
 */
class LogsViewModelTest {
    private fun TestScope.viewModel(socket: FakeLogsSocket, service: String = "web") =
        LogsViewModel("proj-1", "main", service, socket, backgroundScope)

    @Test
    fun `initial state has empty lines and is not connected`() = runTest {
        val socket = FakeLogsSocket()
        val viewModel = viewModel(socket)

        assertEquals(emptyList(), viewModel.state.value.lines)
        assertFalse(viewModel.state.value.isConnected)
    }

    @Test
    fun `connecting opens the socket for the given service and appends output chunks in arrival order`() = runTest {
        val socket = FakeLogsSocket()
        val viewModel = viewModel(socket)
        runCurrent()

        socket.events.emit(LogsEvent.Output("hello\n"))
        socket.events.emit(LogsEvent.Output("world\n"))
        runCurrent()

        assertEquals(listOf(FakeLogsSocket.ConnectCall("proj-1", "main", "web")), socket.connectedCalls)
        assertEquals(listOf("hello\n", "world\n"), viewModel.state.value.lines)
    }

    @Test
    fun `Opened event sets isConnected true`() = runTest {
        val socket = FakeLogsSocket()
        val viewModel = viewModel(socket)
        runCurrent()

        socket.events.emit(LogsEvent.Opened)
        runCurrent()

        assertTrue(viewModel.state.value.isConnected)
    }

    @Test
    fun `Closed event with a cause clears isConnected -- sets errorMessage -- keeps accumulated output`() = runTest {
        val socket = FakeLogsSocket()
        val viewModel = viewModel(socket)
        runCurrent()
        socket.events.emit(LogsEvent.Opened)
        socket.events.emit(LogsEvent.Output("hello\n"))
        runCurrent()

        socket.events.emit(LogsEvent.Closed(RuntimeException("boom")))
        runCurrent()

        assertFalse(viewModel.state.value.isConnected)
        assertEquals(listOf("hello\n"), viewModel.state.value.lines)
        assertEquals("boom", viewModel.state.value.errorMessage)
    }

    @Test
    fun `Closed event with a null cause leaves errorMessage null`() = runTest {
        val socket = FakeLogsSocket()
        val viewModel = viewModel(socket)
        runCurrent()
        socket.events.emit(LogsEvent.Opened)
        runCurrent()

        socket.events.emit(LogsEvent.Closed(null))
        runCurrent()

        assertFalse(viewModel.state.value.isConnected)
        assertNull(viewModel.state.value.errorMessage)
    }

    @Test
    fun `an unexpected close automatically reconnects to the same service after the backoff delay`() = runTest {
        val socket = FakeLogsSocket()
        val viewModel = viewModel(socket)
        runCurrent()

        socket.events.emit(LogsEvent.Closed(RuntimeException("dropped")))
        advanceTimeBy(1001)

        assertEquals(
            listOf(
                FakeLogsSocket.ConnectCall("proj-1", "main", "web"),
                FakeLogsSocket.ConnectCall("proj-1", "main", "web"),
            ),
            socket.connectedCalls,
        )
    }

    @Test
    fun `close does not schedule an automatic reconnect`() = runTest {
        val socket = FakeLogsSocket()
        val viewModel = viewModel(socket)
        runCurrent()

        viewModel.close()
        advanceTimeBy(15_000)

        assertEquals(listOf(FakeLogsSocket.ConnectCall("proj-1", "main", "web")), socket.connectedCalls)
    }

    @Test
    fun `repeated unexpected closes back off exponentially before each reconnect`() = runTest {
        val socket = FakeLogsSocket()
        val viewModel = viewModel(socket)
        runCurrent()

        socket.events.emit(LogsEvent.Closed(null))
        advanceTimeBy(999)
        assertEquals(1, socket.connectedCalls.size)
        advanceTimeBy(2)
        assertEquals(2, socket.connectedCalls.size)

        socket.events.emit(LogsEvent.Closed(null))
        advanceTimeBy(1999)
        assertEquals(2, socket.connectedCalls.size)
        advanceTimeBy(2)
        assertEquals(3, socket.connectedCalls.size)
    }

    @Test
    fun `switchService closes the current socket -- reconnects with the new service -- resets the buffer`() = runTest {
        val socket = FakeLogsSocket()
        val viewModel = viewModel(socket, service = "web")
        runCurrent()
        socket.events.emit(LogsEvent.Output("old output\n"))
        runCurrent()
        assertEquals(listOf("old output\n"), viewModel.state.value.lines)

        viewModel.switchService("worker")
        runCurrent()

        assertEquals(1, socket.closeCallCount)
        assertEquals(
            listOf(
                FakeLogsSocket.ConnectCall("proj-1", "main", "web"),
                FakeLogsSocket.ConnectCall("proj-1", "main", "worker"),
            ),
            socket.connectedCalls,
        )
        assertEquals(emptyList(), viewModel.state.value.lines)

        socket.events.emit(LogsEvent.Output("new output\n"))
        runCurrent()
        assertEquals(listOf("new output\n"), viewModel.state.value.lines)
    }

    @Test
    fun `close disposes the underlying socket`() = runTest {
        val socket = FakeLogsSocket()
        val viewModel = viewModel(socket)
        runCurrent()

        viewModel.close()
        runCurrent()

        assertEquals(1, socket.closeCallCount)
    }
}
