package com.tanyudii.tmuxweb.presentation

import app.cash.turbine.test
import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.domain.model.SessionCreationPhase
import com.tanyudii.tmuxweb.domain.model.SessionCreationStatus
import com.tanyudii.tmuxweb.presentation.fakes.FakeSessionsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Ports SessionListView.swift's `@State` machine and NewSessionSheet.swift's
 * 1s creation-progress poll 1:1.
 */
class SessionListViewModelTest {
    private fun session(name: String = "s1") =
        ProjectSession(name = name, fullName = "proj-1__$name", windows = 1, attached = false)

    private fun immediateViewModel(repository: FakeSessionsRepository): SessionListViewModel {
        val scope = CoroutineScope(UnconfinedTestDispatcher())
        return SessionListViewModel("proj-1", repository, scope)
    }

    @Test
    fun `load populates sessions from repository`() = runTest {
        val repository = FakeSessionsRepository(listOf(session()))

        immediateViewModel(repository).state.test {
            assertEquals(listOf(session()), awaitItem().sessions)
        }
    }

    @Test
    fun `load failure surfaces error message`() = runTest {
        val repository = FakeSessionsRepository().apply { listError = ApiError.Server(500, "boom") }

        immediateViewModel(repository).state.test {
            assertEquals("boom", awaitItem().errorMessage)
        }
    }

    @Test
    fun `delete removes session on success`() = runTest {
        val repository = FakeSessionsRepository(listOf(session()))
        val viewModel = immediateViewModel(repository)

        viewModel.state.test {
            awaitItem()
            viewModel.delete(session())
            assertEquals(emptyList(), awaitItem().sessions)
        }
    }

    @Test
    fun `delete conflict sets pendingForceDelete instead of error`() = runTest {
        val repository = FakeSessionsRepository(listOf(session())).apply {
            deleteError = ApiError.Conflict("uncommitted changes", sessionCount = null)
        }
        val viewModel = immediateViewModel(repository)

        viewModel.state.test {
            awaitItem()
            viewModel.delete(session())
            val state = awaitItem()
            assertEquals(session(), state.pendingForceDelete?.session)
            assertEquals("uncommitted changes", state.pendingForceDelete?.message)
        }
    }

    @Test
    fun `confirmForceDelete removes session and clears pending`() = runTest {
        val repository = FakeSessionsRepository(listOf(session())).apply {
            deleteError = ApiError.Conflict("uncommitted changes", sessionCount = null)
        }
        val viewModel = immediateViewModel(repository)

        viewModel.state.test {
            awaitItem()
            viewModel.delete(session())
            awaitItem()
            repository.deleteError = null
            viewModel.confirmForceDelete()
            assertNull(awaitItem().pendingForceDelete)
            assertEquals(emptyList(), awaitItem().sessions)
        }
    }

    @Test
    fun `cancelForceDelete clears pending without deleting`() = runTest {
        val repository = FakeSessionsRepository(listOf(session())).apply {
            deleteError = ApiError.Conflict("uncommitted changes", sessionCount = null)
        }
        val viewModel = immediateViewModel(repository)

        viewModel.state.test {
            awaitItem()
            viewModel.delete(session())
            awaitItem()
            viewModel.cancelForceDelete()
            val state = awaitItem()
            assertNull(state.pendingForceDelete)
            assertEquals(listOf(session()), state.sessions)
        }
    }

    @Test
    fun `createSession polls until ready then adds session and closes sheet`() = runTest {
        val repository = FakeSessionsRepository()
        repository.creationStatusQueue.addAll(
            listOf(
                Result.success(SessionCreationStatus(phase = SessionCreationPhase.CREATING, message = "Cloning...")),
                Result.success(SessionCreationStatus(phase = SessionCreationPhase.READY, session = session("feature"))),
            ),
        )
        val scope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val viewModel = SessionListViewModel("proj-1", repository, scope)
        advanceUntilIdle()

        viewModel.createSession("feature")
        advanceUntilIdle()

        val state = viewModel.state.value
        assertNull(state.sessionCreation)
        assertEquals(listOf(session("feature")), state.sessions)
    }

    @Test
    fun `createSession surfaces error phase without closing sheet`() = runTest {
        val repository = FakeSessionsRepository()
        repository.creationStatusQueue.addAll(
            listOf(
                Result.success(SessionCreationStatus(phase = SessionCreationPhase.CREATING, message = "Cloning...")),
                Result.success(SessionCreationStatus(phase = SessionCreationPhase.ERROR, message = "git fetch failed")),
            ),
        )
        val scope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val viewModel = SessionListViewModel("proj-1", repository, scope)
        advanceUntilIdle()

        viewModel.createSession("feature")
        advanceUntilIdle()

        val state = viewModel.state.value
        assertTrue(state.sessions.isEmpty())
        assertEquals(false, state.sessionCreation?.isSaving)
        assertEquals("git fetch failed", state.sessionCreation?.errorMessage)
    }

    @Test
    fun `createSession start failure surfaces error without polling`() = runTest {
        val repository = FakeSessionsRepository().apply {
            startCreationError = ApiError.BadRequest("name is required")
        }
        val scope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val viewModel = SessionListViewModel("proj-1", repository, scope)
        advanceUntilIdle()

        viewModel.createSession("")
        advanceUntilIdle()

        assertEquals("name is required", viewModel.state.value.sessionCreation?.errorMessage)
    }

    @Test
    fun `cancelSessionCreation stops the poll loop and clears the sheet`() = runTest {
        val repository = FakeSessionsRepository()
        repository.creationStatusQueue.add(
            Result.success(SessionCreationStatus(phase = SessionCreationPhase.CREATING, message = "Cloning...")),
        )
        val scope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val viewModel = SessionListViewModel("proj-1", repository, scope)
        advanceUntilIdle()

        viewModel.createSession("feature")
        advanceUntilIdle()
        viewModel.cancelSessionCreation()
        advanceUntilIdle()

        assertNull(viewModel.state.value.sessionCreation)
        assertTrue(viewModel.state.value.sessions.isEmpty())
    }
}
