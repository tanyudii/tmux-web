package com.tanyudii.tmuxweb.presentation

import app.cash.turbine.test
import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.SessionStatusFilter
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
import kotlin.test.assertFalse
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

    @Test
    fun `toggleSelectionMode enters selection mode and exiting clears the selection`() = runTest {
        val repository = FakeSessionsRepository(listOf(session("a")))
        val viewModel = immediateViewModel(repository)

        viewModel.bulkDelete.toggleSelectionMode()
        assertTrue(viewModel.state.value.isSelectionMode)

        viewModel.bulkDelete.toggleSessionSelected("a")
        assertEquals(setOf("a"), viewModel.state.value.selectedNames)

        viewModel.bulkDelete.toggleSelectionMode()
        assertFalse(viewModel.state.value.isSelectionMode)
        assertEquals(emptySet(), viewModel.state.value.selectedNames)
    }

    @Test
    fun `toggleSessionSelected adds and removes a name`() = runTest {
        val viewModel = immediateViewModel(FakeSessionsRepository(listOf(session("a"))))

        viewModel.bulkDelete.toggleSessionSelected("a")
        assertEquals(setOf("a"), viewModel.state.value.selectedNames)

        viewModel.bulkDelete.toggleSessionSelected("a")
        assertEquals(emptySet(), viewModel.state.value.selectedNames)
    }

    @Test
    fun `requestBulkDelete is a no-op when nothing is selected`() = runTest {
        val viewModel = immediateViewModel(FakeSessionsRepository(listOf(session("a"))))

        viewModel.bulkDelete.requestBulkDelete()

        assertNull(viewModel.state.value.pendingBulkDelete)
    }

    @Test
    fun `requestBulkDelete stages the selected names for confirmation`() = runTest {
        val viewModel = immediateViewModel(FakeSessionsRepository(listOf(session("a"), session("b"))))
        viewModel.bulkDelete.toggleSessionSelected("a")

        viewModel.bulkDelete.requestBulkDelete()

        assertEquals(setOf("a"), viewModel.state.value.pendingBulkDelete?.names)
    }

    @Test
    fun `confirmBulkDelete deletes every selected session and exits selection mode when none conflict`() = runTest {
        val repository = FakeSessionsRepository(listOf(session("a"), session("b"), session("c")))
        val scope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val viewModel = SessionListViewModel("proj-1", repository, scope)
        advanceUntilIdle()
        viewModel.bulkDelete.toggleSelectionMode()
        viewModel.bulkDelete.toggleSessionSelected("a")
        viewModel.bulkDelete.toggleSessionSelected("b")
        viewModel.bulkDelete.requestBulkDelete()

        viewModel.bulkDelete.confirmBulkDelete()
        advanceUntilIdle()

        val state = viewModel.state.value
        assertEquals(listOf(session("c")), state.sessions)
        assertFalse(state.isSelectionMode)
        assertEquals(emptySet(), state.selectedNames)
        assertNull(state.pendingBulkForceDelete)
        assertEquals(setOf(Triple("a", false, false), Triple("b", false, false)), repository.deleteSessionCalls.toSet())
    }

    @Test
    fun `confirmBulkDelete never force-deletes a conflicting session -- it stages a separate confirmation`() = runTest {
        val repository = FakeSessionsRepository(listOf(session("a"), session("b"))).apply {
            deleteErrors["b"] = ApiError.Conflict("uncommitted changes", sessionCount = null)
        }
        val scope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val viewModel = SessionListViewModel("proj-1", repository, scope)
        advanceUntilIdle()
        viewModel.bulkDelete.toggleSelectionMode()
        viewModel.bulkDelete.toggleSessionSelected("a")
        viewModel.bulkDelete.toggleSessionSelected("b")
        viewModel.bulkDelete.requestBulkDelete()

        viewModel.bulkDelete.confirmBulkDelete()
        advanceUntilIdle()

        val state = viewModel.state.value
        // "a" had no conflict, so it's genuinely gone; "b" conflicted and must
        // still be alive, waiting on its own force-delete confirmation.
        assertEquals(listOf(session("b")), state.sessions)
        assertEquals(listOf(session("b")), state.pendingBulkForceDelete?.sessions)
        assertTrue(state.isSelectionMode)
        // Never called with force=true during the first pass.
        assertTrue(repository.deleteSessionCalls.none { it.second })
    }

    @Test
    fun `confirmBulkForceDelete deletes the conflicting sessions with force`() = runTest {
        val repository = FakeSessionsRepository(listOf(session("a"), session("b"))).apply {
            deleteErrors["b"] = ApiError.Conflict("uncommitted changes", sessionCount = null)
        }
        val scope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val viewModel = SessionListViewModel("proj-1", repository, scope)
        advanceUntilIdle()
        viewModel.bulkDelete.toggleSelectionMode()
        viewModel.bulkDelete.toggleSessionSelected("a")
        viewModel.bulkDelete.toggleSessionSelected("b")
        viewModel.bulkDelete.requestBulkDelete()
        viewModel.bulkDelete.confirmBulkDelete()
        advanceUntilIdle()
        repository.deleteErrors.clear()

        viewModel.bulkDelete.confirmBulkForceDelete()
        advanceUntilIdle()

        val state = viewModel.state.value
        assertEquals(emptyList(), state.sessions)
        assertFalse(state.isSelectionMode)
        assertNull(state.pendingBulkForceDelete)
        assertTrue(repository.deleteSessionCalls.any { it.first == "b" && it.second })
    }

    @Test
    fun `cancelBulkForceDelete leaves the conflicting sessions alone and exits selection mode`() = runTest {
        val repository = FakeSessionsRepository(listOf(session("a"), session("b"))).apply {
            deleteErrors["b"] = ApiError.Conflict("uncommitted changes", sessionCount = null)
        }
        val scope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val viewModel = SessionListViewModel("proj-1", repository, scope)
        advanceUntilIdle()
        viewModel.bulkDelete.toggleSelectionMode()
        viewModel.bulkDelete.toggleSessionSelected("a")
        viewModel.bulkDelete.toggleSessionSelected("b")
        viewModel.bulkDelete.requestBulkDelete()
        viewModel.bulkDelete.confirmBulkDelete()
        advanceUntilIdle()

        viewModel.bulkDelete.cancelBulkForceDelete()

        val state = viewModel.state.value
        assertEquals(listOf(session("b")), state.sessions)
        assertNull(state.pendingBulkForceDelete)
        assertFalse(state.isSelectionMode)
        assertEquals(emptySet(), state.selectedNames)
    }

    @Test
    fun `filteredSessions reflects the active status and branch filters`() = runTest {
        val active = session("feature-login").copy(attached = true)
        val idle = session("bugfix-nav").copy(attached = false)
        val viewModel = immediateViewModel(FakeSessionsRepository(listOf(active, idle)))

        viewModel.setStatusFilter(SessionStatusFilter.ACTIVE)
        assertEquals(listOf(active), viewModel.state.value.filteredSessions)

        viewModel.setStatusFilter(SessionStatusFilter.ALL)
        viewModel.setBranchQuery("bugfix")
        assertEquals(listOf(idle), viewModel.state.value.filteredSessions)
    }

    @Test
    fun `setSessionMeta updates the matching session's label and favorite on success`() = runTest {
        val repository = FakeSessionsRepository(listOf(session("a"), session("b")))
        val viewModel = immediateViewModel(repository)

        viewModel.setSessionMeta(session("a"), "Important", true)

        val updated = viewModel.state.value.sessions.first { it.name == "a" }
        assertEquals("Important", updated.label)
        assertTrue(updated.favorite)
        // Untouched session stays exactly as it was.
        assertEquals(session("b"), viewModel.state.value.sessions.first { it.name == "b" })
        assertEquals(listOf(Triple("a", "Important" as String?, true)), repository.setSessionMetaCalls)
    }

    @Test
    fun `setSessionMeta surfaces a failure as an error message without changing local state`() = runTest {
        val repository = FakeSessionsRepository(listOf(session("a"))).apply {
            setSessionMetaError = RuntimeException("network down")
        }
        val viewModel = immediateViewModel(repository)

        viewModel.setSessionMeta(session("a"), "Important", true)

        assertEquals("network down", viewModel.state.value.errorMessage)
        assertEquals(session("a"), viewModel.state.value.sessions.first())
    }
}
