package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.ChangedFile
import com.tanyudii.tmuxweb.domain.model.FileStatus
import com.tanyudii.tmuxweb.domain.model.GroupedChanges
import com.tanyudii.tmuxweb.presentation.fakes.FakeChangesRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Ports ChangesListView.swift's 5s poll loop — see plan §2.6 (poll intervals kept as-is, tested with virtual time). */
class ChangesViewModelTest {
    private fun changes(vararg staged: String) = GroupedChanges(
        staged = staged.map { ChangedFile(path = it, oldPath = null, status = FileStatus.MODIFIED, staged = true) },
        unstaged = emptyList(),
        untracked = emptyList(),
    )

    private fun viewModel(repository: FakeChangesRepository, scheduler: TestCoroutineScheduler) =
        ChangesViewModel("proj-1", "main", repository, CoroutineScope(StandardTestDispatcher(scheduler)))

    @Test
    fun `initial load populates changes`() = runTest {
        val repository = FakeChangesRepository(default = changes("a.txt"))
        val viewModel = viewModel(repository, testScheduler)

        advanceUntilIdle()

        assertEquals(changes("a.txt"), viewModel.state.value.changes)
    }

    @Test
    fun `poll reloads again after 5 seconds`() = runTest {
        val repository = FakeChangesRepository()
        repository.changesQueue.addAll(
            listOf(Result.success(changes("a.txt")), Result.success(changes("a.txt", "b.txt"))),
        )
        val viewModel = viewModel(repository, testScheduler)
        advanceUntilIdle()
        assertEquals(changes("a.txt"), viewModel.state.value.changes)

        advanceTimeBy(5_001)

        assertEquals(changes("a.txt", "b.txt"), viewModel.state.value.changes)
    }

    @Test
    fun `poll does not reload before 5 seconds elapse`() = runTest {
        val repository = FakeChangesRepository()
        repository.changesQueue.addAll(
            listOf(Result.success(changes("a.txt")), Result.success(changes("a.txt", "b.txt"))),
        )
        val viewModel = viewModel(repository, testScheduler)
        advanceUntilIdle()

        advanceTimeBy(2_000)

        assertEquals(changes("a.txt"), viewModel.state.value.changes)
    }

    @Test
    fun `load failure surfaces error and a later success clears it`() = runTest {
        val repository = FakeChangesRepository()
        repository.changesQueue.addAll(
            listOf(Result.failure(ApiError.Server(500, "boom")), Result.success(changes("a.txt"))),
        )
        val viewModel = viewModel(repository, testScheduler)
        advanceUntilIdle()
        assertEquals("boom", viewModel.state.value.errorMessage)

        advanceTimeBy(5_001)

        assertNull(viewModel.state.value.errorMessage)
        assertEquals(changes("a.txt"), viewModel.state.value.changes)
    }

    @Test
    fun `refresh triggers an immediate reload outside the poll cadence`() = runTest {
        val repository = FakeChangesRepository()
        repository.changesQueue.add(Result.success(changes("a.txt")))
        val viewModel = viewModel(repository, testScheduler)
        advanceUntilIdle()
        repository.changesQueue.add(Result.success(changes("a.txt", "b.txt")))

        viewModel.refresh()
        advanceUntilIdle()

        assertEquals(changes("a.txt", "b.txt"), viewModel.state.value.changes)
    }

    @Test
    fun `dismissError clears error without touching changes`() = runTest {
        val repository = FakeChangesRepository()
        repository.changesQueue.add(Result.failure(ApiError.Server(500, "boom")))
        val viewModel = viewModel(repository, testScheduler)
        advanceUntilIdle()

        viewModel.dismissError()

        assertNull(viewModel.state.value.errorMessage)
    }
}
