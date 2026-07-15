package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.DirectoryEntry
import com.tanyudii.tmuxweb.domain.model.DirectoryListing
import com.tanyudii.tmuxweb.presentation.fakes.FakeBrowseRepository
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Ports the old iOS DirectoryBrowserView's navigation model (see plan §2.2,
 * GET /api/browse) into a shared ViewModel for the new Web repo-path picker.
 */
class DirectoryPickerViewModelTest {
    private fun listing(
        path: String,
        parentPath: String? = null,
        isGitRepo: Boolean = false,
        entries: List<DirectoryEntry> = emptyList(),
        truncated: Boolean = false,
    ) = DirectoryListing(path, parentPath, isGitRepo, entries, truncated)

    private fun TestScope.viewModel(repository: FakeBrowseRepository) =
        DirectoryPickerViewModel(repository, backgroundScope)

    @Test
    fun `initial load browses the server's default starting directory`() = runTest {
        val repository = FakeBrowseRepository(
            default = listing(
                path = "/home/tanyudii",
                parentPath = "/home",
                entries = listOf(DirectoryEntry("srv", "/home/tanyudii/srv", isGitRepo = false)),
            ),
        )
        val viewModel = viewModel(repository)

        runCurrent()

        assertEquals("/home/tanyudii", viewModel.state.value.currentPath)
        assertEquals(listOf<String?>(null), repository.requestedPaths)
    }

    @Test
    fun `open navigates into the tapped entry`() = runTest {
        val repository = FakeBrowseRepository()
        repository.browseQueue.addAll(
            listOf(
                Result.success(
                    listing(
                        path = "/home/tanyudii",
                        entries = listOf(DirectoryEntry("srv", "/home/tanyudii/srv", isGitRepo = false)),
                    ),
                ),
                Result.success(listing(path = "/home/tanyudii/srv", parentPath = "/home/tanyudii", isGitRepo = true)),
            ),
        )
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.open(DirectoryEntry("srv", "/home/tanyudii/srv", isGitRepo = false))
        runCurrent()

        assertEquals("/home/tanyudii/srv", viewModel.state.value.currentPath)
        assertTrue(viewModel.state.value.isCurrentGitRepo)
        assertEquals(listOf(null, "/home/tanyudii/srv"), repository.requestedPaths)
    }

    @Test
    fun `up navigates to the parent path`() = runTest {
        val repository = FakeBrowseRepository()
        repository.browseQueue.addAll(
            listOf(
                Result.success(listing(path = "/home/tanyudii/srv", parentPath = "/home/tanyudii")),
                Result.success(listing(path = "/home/tanyudii", parentPath = "/home")),
            ),
        )
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.up()
        runCurrent()

        assertEquals("/home/tanyudii", viewModel.state.value.currentPath)
    }

    @Test
    fun `up does nothing when already at the top`() = runTest {
        val repository = FakeBrowseRepository(default = listing(path = "/", parentPath = null))
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.up()
        runCurrent()

        assertEquals(listOf<String?>(null), repository.requestedPaths)
    }

    @Test
    fun `load failure surfaces an error message and keeps the previous listing`() = runTest {
        val repository = FakeBrowseRepository()
        repository.browseQueue.addAll(
            listOf(
                Result.success(
                    listing(
                        path = "/home/tanyudii",
                        entries = listOf(DirectoryEntry("root-owned", "/root-owned", isGitRepo = false)),
                    ),
                ),
                Result.failure(ApiError.Server(403, "Permission denied: /root-owned")),
            ),
        )
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.open(DirectoryEntry("root-owned", "/root-owned", isGitRepo = false))
        runCurrent()

        assertEquals("Permission denied: /root-owned", viewModel.state.value.errorMessage)
        assertEquals("/home/tanyudii", viewModel.state.value.currentPath)
    }

    @Test
    fun `retry re-issues the request for the last attempted path after a failure`() = runTest {
        val repository = FakeBrowseRepository()
        repository.browseQueue.addAll(
            listOf(
                Result.success(listing(path = "/home/tanyudii")),
                Result.failure(ApiError.Server(403, "Permission denied: /root-owned")),
                Result.success(listing(path = "/root-owned", parentPath = "/", isGitRepo = true)),
            ),
        )
        val viewModel = viewModel(repository)
        runCurrent()
        viewModel.open(DirectoryEntry("root-owned", "/root-owned", isGitRepo = false))
        runCurrent()
        assertEquals("Permission denied: /root-owned", viewModel.state.value.errorMessage)

        viewModel.retry()
        runCurrent()

        assertNull(viewModel.state.value.errorMessage)
        assertEquals("/root-owned", viewModel.state.value.currentPath)
        assertEquals(listOf(null, "/root-owned", "/root-owned"), repository.requestedPaths)
    }
}
