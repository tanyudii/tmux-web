package com.tanyudii.tmuxweb.presentation

import app.cash.turbine.test
import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.Project
import com.tanyudii.tmuxweb.presentation.fakes.FakeProjectsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Ports ProjectListView.swift's load/delete/forceDelete state machine 1:1. */
class ProjectListViewModelTest {
    private fun project(id: String = "p1") = Project(id = id, name = "demo", repoPath = "/repo", createdAt = "now")

    private fun viewModel(repository: FakeProjectsRepository): ProjectListViewModel {
        val scope = CoroutineScope(UnconfinedTestDispatcher())
        return ProjectListViewModel(repository, scope)
    }

    @Test
    fun `load populates projects from repository`() = runTest {
        val repository = FakeProjectsRepository(listOf(project()))

        viewModel(repository).state.test {
            assertEquals(listOf(project()), awaitItem().projects)
        }
    }

    @Test
    fun `load failure surfaces error message`() = runTest {
        val repository = FakeProjectsRepository().apply { listError = ApiError.Server(500, "boom") }

        viewModel(repository).state.test {
            assertEquals("boom", awaitItem().errorMessage)
        }
    }

    @Test
    fun `addProject appends without reloading`() = runTest {
        val repository = FakeProjectsRepository()
        val viewModel = viewModel(repository)
        val added = project("new")

        viewModel.state.test {
            awaitItem()
            viewModel.addProject(added)
            assertEquals(listOf(added), awaitItem().projects)
        }
    }

    @Test
    fun `delete removes project on success`() = runTest {
        val repository = FakeProjectsRepository(listOf(project()))
        val viewModel = viewModel(repository)

        viewModel.state.test {
            awaitItem()
            viewModel.delete(project())
            assertEquals(emptyList(), awaitItem().projects)
        }
    }

    @Test
    fun `delete conflict sets pendingForceDelete instead of error`() = runTest {
        val repository = FakeProjectsRepository(listOf(project())).apply {
            deleteError = ApiError.Conflict("still has sessions", sessionCount = 2)
        }
        val viewModel = viewModel(repository)

        viewModel.state.test {
            awaitItem()
            viewModel.delete(project())
            val state = awaitItem()
            assertEquals(project(), state.pendingForceDelete?.project)
            assertEquals("still has sessions", state.pendingForceDelete?.message)
            assertNull(state.errorMessage)
        }
    }

    @Test
    fun `confirmForceDelete removes project and clears pending`() = runTest {
        val repository = FakeProjectsRepository(listOf(project())).apply {
            deleteError = ApiError.Conflict("still has sessions", sessionCount = 2)
        }
        val viewModel = viewModel(repository)

        viewModel.state.test {
            awaitItem()
            viewModel.delete(project())
            awaitItem()
            repository.deleteError = null
            viewModel.confirmForceDelete()
            val clearedPending = awaitItem()
            assertNull(clearedPending.pendingForceDelete)
            val removed = awaitItem()
            assertEquals(emptyList(), removed.projects)
        }
    }

    @Test
    fun `cancelForceDelete clears pending without deleting`() = runTest {
        val repository = FakeProjectsRepository(listOf(project())).apply {
            deleteError = ApiError.Conflict("still has sessions", sessionCount = 2)
        }
        val viewModel = viewModel(repository)

        viewModel.state.test {
            awaitItem()
            viewModel.delete(project())
            awaitItem()
            viewModel.cancelForceDelete()
            val state = awaitItem()
            assertNull(state.pendingForceDelete)
            assertEquals(listOf(project()), state.projects)
        }
    }

    @Test
    fun `showNewProjectSheet opens sheet in non-saving state`() = runTest {
        val viewModel = viewModel(FakeProjectsRepository())

        viewModel.state.test {
            awaitItem()
            viewModel.showNewProjectSheet()
            val state = awaitItem()
            assertEquals(false, state.newProject?.isSaving)
            assertNull(state.newProject?.errorMessage)
        }
    }

    @Test
    fun `cancelNewProject closes the sheet`() = runTest {
        val viewModel = viewModel(FakeProjectsRepository())

        viewModel.state.test {
            awaitItem()
            viewModel.showNewProjectSheet()
            awaitItem()
            viewModel.cancelNewProject()
            assertNull(awaitItem().newProject)
        }
    }

    @Test
    fun `createProject adds the created project and closes the sheet`() = runTest {
        val repository = FakeProjectsRepository()
        val viewModel = viewModel(repository)

        viewModel.state.test {
            awaitItem()
            viewModel.showNewProjectSheet()
            awaitItem()
            viewModel.createProject("demo", "/repo")
            val saving = awaitItem()
            assertEquals(true, saving.newProject?.isSaving)
            val created = awaitItem()
            assertNull(created.newProject)
            assertEquals(listOf(repository.projects.single()), created.projects)
        }
    }

    @Test
    fun `createProject failure surfaces error on the sheet without closing it`() = runTest {
        val repository = FakeProjectsRepository().apply { createError = ApiError.Server(500, "boom") }
        val viewModel = viewModel(repository)

        viewModel.state.test {
            awaitItem()
            viewModel.showNewProjectSheet()
            awaitItem()
            viewModel.createProject("demo", "/repo")
            awaitItem()
            val failed = awaitItem()
            assertEquals(false, failed.newProject?.isSaving)
            assertEquals("boom", failed.newProject?.errorMessage)
            assertEquals(emptyList(), failed.projects)
        }
    }

    @Test
    fun `dismissError clears error message`() = runTest {
        val repository = FakeProjectsRepository().apply { listError = ApiError.Server(500, "boom") }
        val viewModel = viewModel(repository)

        viewModel.state.test {
            awaitItem()
            viewModel.dismissError()
            assertNull(awaitItem().errorMessage)
        }
    }
}
