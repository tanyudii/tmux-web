package com.tanyudii.tmuxweb.ui.sessions

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.presentation.fakes.FakeProjectsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * [DeleteProjectState] itself has no Compose/UI dependency (its
 * `mutableStateOf` properties are just an observable state holder, same
 * shape as any ViewModel), so it's unit-testable directly with a fake
 * repository despite living in `ui.sessions` -- see PR #35 review, this
 * class previously had zero test coverage.
 */
class DeleteProjectStateTest {
    private fun state(
        repository: FakeProjectsRepository,
        onDeleted: () -> Unit = {},
    ): DeleteProjectState {
        val scope = CoroutineScope(UnconfinedTestDispatcher())
        return DeleteProjectState("p1", repository, scope, onDeleted)
    }

    @Test
    fun `requestDelete without attached sessions deletes immediately`() = runTest {
        val repository = FakeProjectsRepository()
        var deleted = false

        state(repository, onDeleted = { deleted = true }).requestDelete(hasAttachedSessions = false)

        assertTrue(deleted)
    }

    @Test
    fun `requestDelete with attached sessions asks for confirmation instead of deleting`() = runTest {
        val repository = FakeProjectsRepository()
        var deleted = false

        val delegate = state(repository, onDeleted = { deleted = true })
        delegate.requestDelete(hasAttachedSessions = true)

        assertFalse(deleted)
        assertEquals("Active sessions will be killed.", delegate.pendingForceMessage)
    }

    @Test
    fun `confirmForceDelete clears the pending prompt and deletes with force`() = runTest {
        val repository = FakeProjectsRepository()
        var deleted = false
        val delegate = state(repository, onDeleted = { deleted = true })
        delegate.requestDelete(hasAttachedSessions = true)

        delegate.confirmForceDelete()

        assertNull(delegate.pendingForceMessage)
        assertTrue(deleted)
    }

    @Test
    fun `cancel clears the pending prompt without deleting`() = runTest {
        val repository = FakeProjectsRepository()
        var deleted = false
        val delegate = state(repository, onDeleted = { deleted = true })
        delegate.requestDelete(hasAttachedSessions = true)

        delegate.cancel()

        assertNull(delegate.pendingForceMessage)
        assertFalse(deleted)
    }

    @Test
    fun `conflict failure sets pendingForceMessage from the server instead of errorMessage`() = runTest {
        val repository = FakeProjectsRepository().apply {
            deleteError = ApiError.Conflict("still has sessions", sessionCount = 2)
        }
        val delegate = state(repository)

        delegate.requestDelete(hasAttachedSessions = false)

        assertEquals("still has sessions", delegate.pendingForceMessage)
        assertNull(delegate.errorMessage)
    }

    @Test
    fun `non-conflict failure sets errorMessage instead of pendingForceMessage`() = runTest {
        val repository = FakeProjectsRepository().apply { deleteError = ApiError.Server(500, "boom") }
        val delegate = state(repository)

        delegate.requestDelete(hasAttachedSessions = false)

        assertEquals("boom", delegate.errorMessage)
        assertNull(delegate.pendingForceMessage)
    }

    @Test
    fun `dismissError clears the error message`() = runTest {
        val repository = FakeProjectsRepository().apply { deleteError = ApiError.Server(500, "boom") }
        val delegate = state(repository)
        delegate.requestDelete(hasAttachedSessions = false)

        delegate.dismissError()

        assertNull(delegate.errorMessage)
    }
}
