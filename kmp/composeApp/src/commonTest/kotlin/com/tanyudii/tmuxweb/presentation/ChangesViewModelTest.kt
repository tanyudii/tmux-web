package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.ChangedFile
import com.tanyudii.tmuxweb.domain.model.DiffMode
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

    private fun file(path: String) = ChangedFile(path = path, oldPath = null, status = FileStatus.MODIFIED, staged = false)

    @Test
    fun `stage calls the repository and reloads changes`() = runTest {
        val repository = FakeChangesRepository()
        repository.changesQueue.add(Result.success(changes()))
        val viewModel = viewModel(repository)
        runCurrent()
        repository.changesQueue.add(Result.success(changes("a.txt")))

        viewModel.stage(file("a.txt"))
        runCurrent()

        assertEquals(listOf("a.txt"), repository.stageCalls)
        assertEquals(changes("a.txt"), viewModel.state.value.changes)
    }

    @Test
    fun `stage failure surfaces an error`() = runTest {
        val repository = FakeChangesRepository()
        repository.stageResult = Result.failure(ApiError.Server(500, "stage failed"))
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.stage(file("a.txt"))
        runCurrent()

        assertEquals("stage failed", viewModel.state.value.errorMessage)
    }

    @Test
    fun `unstage calls the repository and reloads changes`() = runTest {
        val repository = FakeChangesRepository()
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.unstage(file("a.txt"))
        runCurrent()

        assertEquals(listOf("a.txt"), repository.unstageCalls)
    }

    @Test
    fun `requestDiscard sets pendingDiscard without calling the repository`() = runTest {
        val repository = FakeChangesRepository()
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.requestDiscard(file("a.txt"), DiffMode.UNSTAGED)

        assertEquals(PendingDiscard(file("a.txt"), DiffMode.UNSTAGED), viewModel.state.value.pendingDiscard)
        assertEquals(emptyList(), repository.discardCalls)
    }

    @Test
    fun `cancelDiscard clears pendingDiscard without calling the repository`() = runTest {
        val repository = FakeChangesRepository()
        val viewModel = viewModel(repository)
        runCurrent()
        viewModel.requestDiscard(file("a.txt"), DiffMode.UNSTAGED)

        viewModel.cancelDiscard()

        assertNull(viewModel.state.value.pendingDiscard)
        assertEquals(emptyList(), repository.discardCalls)
    }

    @Test
    fun `confirmDiscard calls the repository, clears pendingDiscard, and reloads`() = runTest {
        val repository = FakeChangesRepository()
        repository.changesQueue.add(Result.success(changes("a.txt")))
        val viewModel = viewModel(repository)
        runCurrent()
        viewModel.requestDiscard(file("a.txt"), DiffMode.STAGED)
        repository.changesQueue.add(Result.success(changes()))

        viewModel.confirmDiscard()
        runCurrent()

        assertEquals(listOf("a.txt" to DiffMode.STAGED), repository.discardCalls)
        assertNull(viewModel.state.value.pendingDiscard)
        assertEquals(changes(), viewModel.state.value.changes)
    }

    @Test
    fun `confirmDiscard failure clears pendingDiscard and surfaces an error`() = runTest {
        val repository = FakeChangesRepository()
        repository.discardResult = Result.failure(ApiError.Server(500, "discard failed"))
        val viewModel = viewModel(repository)
        runCurrent()
        viewModel.requestDiscard(file("a.txt"), DiffMode.UNTRACKED)

        viewModel.confirmDiscard()
        runCurrent()

        assertNull(viewModel.state.value.pendingDiscard)
        assertEquals("discard failed", viewModel.state.value.errorMessage)
    }

    @Test
    fun `confirmDiscard without a pending discard does nothing`() = runTest {
        val repository = FakeChangesRepository()
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.confirmDiscard()
        runCurrent()

        assertEquals(emptyList(), repository.discardCalls)
    }

    @Test
    fun `updateCommitMessage updates state`() = runTest {
        val repository = FakeChangesRepository()
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.updateCommitMessage("fix: a bug")

        assertEquals("fix: a bug", viewModel.state.value.commitMessage)
    }

    @Test
    fun `commit calls the repository, clears the message, and reloads`() = runTest {
        val repository = FakeChangesRepository()
        repository.changesQueue.add(Result.success(changes()))
        val viewModel = viewModel(repository)
        runCurrent()
        viewModel.updateCommitMessage("fix: a bug")

        viewModel.commit()
        runCurrent()

        assertEquals(listOf("fix: a bug"), repository.commitCalls)
        assertEquals("", viewModel.state.value.commitMessage)
        assertEquals(false, viewModel.state.value.isCommitting)
    }

    @Test
    fun `commit with a blank message does nothing`() = runTest {
        val repository = FakeChangesRepository()
        val viewModel = viewModel(repository)
        runCurrent()
        viewModel.updateCommitMessage("   ")

        viewModel.commit()
        runCurrent()

        assertEquals(emptyList(), repository.commitCalls)
    }

    @Test
    fun `commit failure clears isCommitting and surfaces an error without clearing the message`() = runTest {
        val repository = FakeChangesRepository()
        repository.commitResult = Result.failure(ApiError.Conflict("No staged changes to commit", null))
        val viewModel = viewModel(repository)
        runCurrent()
        viewModel.updateCommitMessage("fix: a bug")

        viewModel.commit()
        runCurrent()

        assertEquals(false, viewModel.state.value.isCommitting)
        assertEquals("fix: a bug", viewModel.state.value.commitMessage)
        assertEquals("No staged changes to commit", viewModel.state.value.errorMessage)
    }
}
