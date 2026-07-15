package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.DiffRowType
import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.FileDiff
import com.tanyudii.tmuxweb.presentation.fakes.FakeChangesRepository
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Drives [DiffViewModel] against [FakeChangesRepository] the same way
 * [DirectoryPickerViewModelTest] drives [DirectoryPickerViewModel] -- a
 * one-shot load on init, no polling, so a plain `runCurrent()` after
 * construction is enough to settle it.
 */
class DiffViewModelTest {
    private fun TestScope.viewModel(repository: FakeChangesRepository, mode: DiffMode = DiffMode.UNSTAGED) =
        DiffViewModel("proj-1", "main", "src/tmux.ts", mode, repository, backgroundScope)

    @Test
    fun `loads and parses a real diff on init`() = runTest {
        // Arrange
        val diffText = listOf("@@ -1,1 +1,1 @@", "-old line", "+new line").joinToString("\n")
        val repository = FakeChangesRepository()
        repository.diffResult = Result.success(FileDiff(diff = diffText, isUntracked = false, isBinary = false))

        // Act
        val viewModel = viewModel(repository)
        runCurrent()

        // Assert
        val state = viewModel.state.value
        assertEquals(false, state.isLoading)
        assertNull(state.errorMessage)
        assertEquals(false, state.isBinary)
        assertEquals(false, state.isUntracked)
        val hunk = state.parsedDiff?.hunks?.single()
        assertEquals(listOf(DiffRowType.DEL, DiffRowType.ADD), hunk?.lines?.map { it.type })
    }

    @Test
    fun `untracked file renders every line as an addition`() = runTest {
        // Arrange
        val repository = FakeChangesRepository()
        repository.diffResult = Result.success(FileDiff(diff = "first\nsecond", isUntracked = true, isBinary = false))

        // Act
        val viewModel = viewModel(repository, mode = DiffMode.UNTRACKED)
        runCurrent()

        // Assert
        val state = viewModel.state.value
        assertTrue(state.isUntracked)
        assertEquals(2, state.parsedDiff?.additions)
        assertTrue(state.parsedDiff?.hunks?.single()?.lines.orEmpty().all { it.type == DiffRowType.ADD })
    }

    @Test
    fun `binary file has no parsed diff`() = runTest {
        // Arrange
        val repository = FakeChangesRepository()
        repository.diffResult = Result.success(FileDiff(diff = "", isUntracked = false, isBinary = true))

        // Act
        val viewModel = viewModel(repository)
        runCurrent()

        // Assert
        val state = viewModel.state.value
        assertTrue(state.isBinary)
        assertNull(state.parsedDiff)
        assertEquals(false, state.isLoading)
    }

    @Test
    fun `load failure surfaces an error message`() = runTest {
        // Arrange
        val repository = FakeChangesRepository()
        repository.diffResult = Result.failure(ApiError.Server(500, "boom"))

        // Act
        val viewModel = viewModel(repository)
        runCurrent()

        // Assert
        val state = viewModel.state.value
        assertEquals("boom", state.errorMessage)
        assertEquals(false, state.isLoading)
        assertNull(state.parsedDiff)
    }

    @Test
    fun `state starts in a loading state before the initial load settles`() = runTest {
        // Arrange
        val repository = FakeChangesRepository()
        repository.diffResult = Result.success(FileDiff(diff = "", isUntracked = false, isBinary = false))

        // Act
        val viewModel = viewModel(repository)

        // Assert -- checked before runCurrent(), so the init { load() } launch hasn't resolved yet
        assertTrue(viewModel.state.value.isLoading)
    }
}
