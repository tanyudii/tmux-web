package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.ChangedFile
import com.tanyudii.tmuxweb.domain.model.FileStatus
import com.tanyudii.tmuxweb.domain.model.GroupedChanges
import com.tanyudii.tmuxweb.presentation.fakes.FakeChangesRepository
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Ports ChangesListView.swift's 5s poll loop — see plan §2.6 (poll intervals
 * kept as-is, tested with virtual time). The ViewModel's poll loop runs
 * forever (`while (isActive)`), so it's launched on [TestScope.backgroundScope]
 * — a scope kotlinx-coroutines-test exempts from "must finish" checks — and
 * every settle point uses [runCurrent] (drain only what's ready *now*)
 * instead of `advanceUntilIdle()`, which would spin forever chasing an
 * infinite recurring `delay()`.
 */
class ChangesViewModelTest {
    private fun changes(vararg staged: String) = GroupedChanges(
        staged = staged.map { ChangedFile(path = it, oldPath = null, status = FileStatus.MODIFIED, staged = true) },
        unstaged = emptyList(),
        untracked = emptyList(),
    )

    private fun TestScope.viewModel(repository: FakeChangesRepository) =
        ChangesViewModel("proj-1", "main", repository, backgroundScope)

    @Test
    fun `initial load populates changes`() = runTest {
        val repository = FakeChangesRepository(default = changes("a.txt"))
        val viewModel = viewModel(repository)

        runCurrent()

        assertEquals(changes("a.txt"), viewModel.state.value.changes)
    }

    @Test
    fun `poll reloads again after 5 seconds`() = runTest {
        val repository = FakeChangesRepository()
        repository.changesQueue.addAll(
            listOf(Result.success(changes("a.txt")), Result.success(changes("a.txt", "b.txt"))),
        )
        val viewModel = viewModel(repository)
        runCurrent()
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
        val viewModel = viewModel(repository)
        runCurrent()

        advanceTimeBy(2_000)

        assertEquals(changes("a.txt"), viewModel.state.value.changes)
    }

    @Test
    fun `load failure surfaces error and a later success clears it`() = runTest {
        val repository = FakeChangesRepository()
        repository.changesQueue.addAll(
            listOf(Result.failure(ApiError.Server(500, "boom")), Result.success(changes("a.txt"))),
        )
        val viewModel = viewModel(repository)
        runCurrent()
        assertEquals("boom", viewModel.state.value.errorMessage)

        advanceTimeBy(5_001)

        assertNull(viewModel.state.value.errorMessage)
        assertEquals(changes("a.txt"), viewModel.state.value.changes)
    }

    @Test
    fun `refresh triggers an immediate reload outside the poll cadence`() = runTest {
        val repository = FakeChangesRepository()
        repository.changesQueue.add(Result.success(changes("a.txt")))
        val viewModel = viewModel(repository)
        runCurrent()
        repository.changesQueue.add(Result.success(changes("a.txt", "b.txt")))

        viewModel.refresh()
        runCurrent()

        assertEquals(changes("a.txt", "b.txt"), viewModel.state.value.changes)
    }

    @Test
    fun `dismissError clears error without touching changes`() = runTest {
        val repository = FakeChangesRepository()
        repository.changesQueue.add(Result.failure(ApiError.Server(500, "boom")))
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.dismissError()

        assertNull(viewModel.state.value.errorMessage)
    }
}
