package com.tanyudii.tmuxweb.presentation

import app.cash.turbine.test
import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.Project
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.domain.model.SessionCreationPhase
import com.tanyudii.tmuxweb.domain.model.SessionCreationStatus
import com.tanyudii.tmuxweb.domain.model.SessionTemplate
import com.tanyudii.tmuxweb.presentation.fakes.FakeProjectsRepository
import com.tanyudii.tmuxweb.presentation.fakes.FakeSessionTemplatesRepository
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
 * Ports the sidebar tree/master-detail state machine behind
 * `ui_kits/web/app.jsx`. Assertions read `viewModel.state.value` directly
 * (rather than counting turbine emissions) because every action here can
 * synchronously cascade into nested `scope.launch` work under
 * [UnconfinedTestDispatcher] (e.g. `selectProject` -> `toggleProject` ->
 * `loadSessions`) — the exact emission count is an implementation detail,
 * not the behavior under test.
 */
class WebShellViewModelTest {
    private fun project(id: String = "p1", name: String = "api-gateway") =
        Project(id = id, name = name, repoPath = "~/srv/$name", createdAt = "now")

    private fun session(name: String = "build", projectId: String = "p1") =
        ProjectSession(name = name, fullName = "${projectId}__$name", windows = 1, attached = false)

    private fun immediateViewModel(
        projects: FakeProjectsRepository = FakeProjectsRepository(),
        sessions: FakeSessionsRepository = FakeSessionsRepository(),
        templates: FakeSessionTemplatesRepository = FakeSessionTemplatesRepository(),
    ): WebShellViewModel {
        val scope = CoroutineScope(UnconfinedTestDispatcher())
        return WebShellViewModel(projects, sessions, templates, scope)
    }

    @Test
    fun `loadProjects populates the sidebar tree`() = runTest {
        val projects = FakeProjectsRepository(listOf(project()))

        immediateViewModel(projects = projects).state.test {
            assertEquals(listOf(project()), awaitItem().projects)
        }
    }

    @Test
    fun `toggleProject expands and lazily loads sessions once`() {
        val sessions = FakeSessionsRepository(listOf(session()))
        val viewModel = immediateViewModel(sessions = sessions)

        viewModel.toggleProject("p1")
        assertEquals(setOf("p1"), viewModel.state.value.expandedProjectIds)
        assertEquals(listOf(session()), viewModel.state.value.sessionsByProjectId["p1"])

        viewModel.toggleProject("p1")
        assertEquals(emptySet(), viewModel.state.value.expandedProjectIds)
    }

    @Test
    fun `selectSession sets selection and expands its project`() {
        val viewModel = immediateViewModel(sessions = FakeSessionsRepository(listOf(session())))

        viewModel.selectSession("p1", "build")

        val state = viewModel.state.value
        assertEquals("p1", state.selectedProjectId)
        assertEquals("build", state.selectedSessionName)
        assertTrue("p1" in state.expandedProjectIds)
    }

    @Test
    fun `createProject adds it expanded with an empty session list`() {
        val viewModel = immediateViewModel()

        viewModel.createProject("web-client", "~/srv/web-client")

        val state = viewModel.state.value
        assertEquals(1, state.projects.size)
        assertTrue(state.projects.first().id in state.expandedProjectIds)
        assertEquals(emptyList(), state.sessionsByProjectId[state.projects.first().id])
        assertNull(state.newProjectDialog)
    }

    @Test
    fun `createProject failure keeps the dialog open with an error`() {
        val projects = FakeProjectsRepository().apply { createError = ApiError.BadRequest("name is required") }
        val viewModel = immediateViewModel(projects = projects)

        viewModel.createProject("", "")

        assertEquals("name is required", viewModel.state.value.newProjectDialog?.errorMessage)
    }

    @Test
    fun `createSession polls until ready and selects the new session`() = runTest {
        val sessions = FakeSessionsRepository()
        sessions.creationStatusQueue.addAll(
            listOf(
                Result.success(SessionCreationStatus(phase = SessionCreationPhase.CREATING, message = "Cloning...")),
                Result.success(SessionCreationStatus(phase = SessionCreationPhase.READY, session = session("feature"))),
            ),
        )
        val scope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val viewModel = WebShellViewModel(FakeProjectsRepository(), sessions, FakeSessionTemplatesRepository(), scope)
        advanceUntilIdle()

        viewModel.showNewSessionDialog("p1")
        viewModel.createSession("feature")
        advanceUntilIdle()

        val state = viewModel.state.value
        assertNull(state.newSessionDialog)
        assertEquals(listOf(session("feature")), state.sessionsByProjectId["p1"])
        assertEquals("p1", state.selectedProjectId)
        assertEquals("feature", state.selectedSessionName)
    }

    @Test
    fun `createSession start failure surfaces error without polling`() = runTest {
        val sessions = FakeSessionsRepository().apply { startCreationError = ApiError.BadRequest("name is required") }
        val scope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val viewModel = WebShellViewModel(FakeProjectsRepository(), sessions, FakeSessionTemplatesRepository(), scope)
        advanceUntilIdle()

        viewModel.showNewSessionDialog("p1")
        viewModel.createSession("")
        advanceUntilIdle()

        assertEquals("name is required", viewModel.state.value.newSessionDialog?.errorMessage)
    }

    @Test
    fun `showNewSessionDialog loads the project's saved templates into the dialog`() {
        val template = SessionTemplate(
            id = "t1",
            projectId = "p1",
            name = "Dev server",
            startupCommand = "npm run dev",
            createdAt = "now",
        )
        val templates = FakeSessionTemplatesRepository(listOf(template))
        val viewModel = immediateViewModel(templates = templates)

        viewModel.showNewSessionDialog("p1")

        assertEquals(listOf(template), viewModel.state.value.newSessionDialog?.templates)
    }

    @Test
    fun `createSession threads the startup command through to the repository`() {
        val sessions = FakeSessionsRepository()
        val readyStatus = SessionCreationStatus(phase = SessionCreationPhase.READY, session = session("feature"))
        sessions.creationStatusQueue.addAll(listOf(Result.success(readyStatus)))
        val viewModel = immediateViewModel(sessions = sessions)

        viewModel.showNewSessionDialog("p1")
        viewModel.createSession("feature", "npm run dev")

        val expected = Triple<String, String, String?>("p1", "feature", "npm run dev")
        assertEquals(listOf(expected), sessions.startCreationCalls)
    }

    @Test
    fun `saveAsTemplate adds the created template to the dialog's template list`() {
        val templates = FakeSessionTemplatesRepository()
        val viewModel = immediateViewModel(templates = templates)

        viewModel.showNewSessionDialog("p1")
        viewModel.saveAsTemplate("Dev server", "npm run dev")

        val saved = viewModel.state.value.newSessionDialog?.templates
        assertEquals(1, saved?.size)
        assertEquals("Dev server", saved?.first()?.name)
        assertEquals("npm run dev", saved?.first()?.startupCommand)
    }

    @Test
    fun `deleteTemplate removes the template from the dialog's template list`() {
        val template = SessionTemplate(
            id = "t1",
            projectId = "p1",
            name = "Dev server",
            createdAt = "now",
        )
        val templates = FakeSessionTemplatesRepository(listOf(template))
        val viewModel = immediateViewModel(templates = templates)

        viewModel.showNewSessionDialog("p1")
        viewModel.deleteTemplate("t1")

        assertEquals(emptyList(), viewModel.state.value.newSessionDialog?.templates)
    }

    @Test
    fun `requestDeleteProject conflict escalates to a forced pending delete`() {
        val projects = FakeProjectsRepository(listOf(project())).apply {
            deleteError = ApiError.Conflict("2 active sessions", sessionCount = 2)
        }
        val viewModel = immediateViewModel(projects = projects)

        viewModel.requestDeleteProject(project())
        viewModel.confirmPendingDelete()

        val pending = viewModel.state.value.pendingDelete as WebShellUiState.PendingDelete.OfProject
        assertTrue(pending.forced)
        assertEquals("2 active sessions", pending.message)
    }

    @Test
    fun `confirmPendingDelete on a forced project deletion removes it and clears selection`() {
        val projects = FakeProjectsRepository(listOf(project()))
        val viewModel = immediateViewModel(projects = projects)

        viewModel.selectProject("p1")
        viewModel.requestDeleteProject(project())
        viewModel.confirmPendingDelete()

        val state = viewModel.state.value
        assertTrue(state.projects.isEmpty())
        assertNull(state.selectedProjectId)
        assertNull(state.pendingDelete)
    }

    @Test
    fun `requestDeleteSession success removes only that session`() {
        val sessions = FakeSessionsRepository(listOf(session("build"), session("logs")))
        val viewModel = immediateViewModel(sessions = sessions)

        viewModel.toggleProject("p1")
        viewModel.requestDeleteSession("p1", session("build"))
        viewModel.confirmPendingDelete()

        assertEquals(listOf(session("logs")), viewModel.state.value.sessionsByProjectId["p1"])
    }

    @Test
    fun `deleteSession does not request branch deletion by default`() {
        val sessions = FakeSessionsRepository(listOf(session("build")))
        val viewModel = immediateViewModel(sessions = sessions)

        viewModel.requestDeleteSession("p1", session("build"))
        viewModel.confirmPendingDelete()

        assertEquals(listOf(Triple("build", false, false)), sessions.deleteSessionCalls)
    }

    @Test
    fun `checking Delete branch too on a merged branch deletes immediately on next confirm`() {
        val sessions = FakeSessionsRepository(listOf(session("build"))).apply { branchMerged = true }
        val viewModel = immediateViewModel(sessions = sessions)

        viewModel.requestDeleteSession("p1", session("build"))
        viewModel.setDeleteBranchOnSessionDelete(true)
        val afterCheck = viewModel.state.value.pendingDelete as WebShellUiState.PendingDelete.OfSession
        assertTrue(afterCheck.branchMergeChecked)
        assertEquals(true, afterCheck.branchMerged)

        viewModel.confirmPendingDelete()

        assertEquals(listOf(Triple("build", false, true)), sessions.deleteSessionCalls)
        assertNull(viewModel.state.value.pendingDelete)
    }

    @Test
    fun `checking Delete branch too on an unmerged branch requires a second confirm before deleting`() {
        val sessions = FakeSessionsRepository(listOf(session("build"))).apply { branchMerged = false }
        val viewModel = immediateViewModel(sessions = sessions)

        viewModel.requestDeleteSession("p1", session("build"))
        viewModel.setDeleteBranchOnSessionDelete(true)

        // First confirm click only escalates the dialog -- nothing deleted yet.
        viewModel.confirmPendingDelete()
        assertEquals(emptyList(), sessions.deleteSessionCalls)
        val escalated = viewModel.state.value.pendingDelete as WebShellUiState.PendingDelete.OfSession
        assertTrue(escalated.unmergedConfirmed)

        // Second confirm click actually deletes, with deleteBranch=true.
        viewModel.confirmPendingDelete()
        assertEquals(listOf(Triple("build", false, true)), sessions.deleteSessionCalls)
    }

    @Test
    fun `unchecking Delete branch too resets the merge-check state`() {
        val sessions = FakeSessionsRepository(listOf(session("build"))).apply { branchMerged = false }
        val viewModel = immediateViewModel(sessions = sessions)

        viewModel.requestDeleteSession("p1", session("build"))
        viewModel.setDeleteBranchOnSessionDelete(true)
        viewModel.setDeleteBranchOnSessionDelete(false)

        val pending = viewModel.state.value.pendingDelete as WebShellUiState.PendingDelete.OfSession
        assertFalse(pending.deleteBranch)
        assertFalse(pending.branchMergeChecked)
        assertNull(pending.branchMerged)
    }

    @Test
    fun `confirmPendingDelete on the selected session clears its selection before the delete request resolves`() =
        runTest {
            // StandardTestDispatcher (unlike the other tests' Unconfined one)
            // leaves scope.launch queued rather than run to completion, so
            // this proves the selection is cleared synchronously -- i.e.
            // before the DELETE call even starts -- rather than merely as a
            // side effect of it succeeding. This is what tears down the
            // terminal composable's socket immediately instead of leaving it
            // open until a possibly-slow delete (env teardown) resolves.
            val scope = CoroutineScope(StandardTestDispatcher(testScheduler))
            val sessions = FakeSessionsRepository(listOf(session("build")))
            val viewModel =
                WebShellViewModel(FakeProjectsRepository(), sessions, FakeSessionTemplatesRepository(), scope)

            viewModel.selectSession("p1", "build")
            viewModel.requestDeleteSession("p1", session("build"))
            viewModel.confirmPendingDelete()

            assertNull(viewModel.state.value.selectedSessionName)

            advanceUntilIdle()
            assertTrue(sessions.sessions.none { it.name == "build" })
        }

    @Test
    fun `confirmPendingDelete restores the selection when the session delete fails`() {
        val sessions = FakeSessionsRepository(listOf(session("build"))).apply {
            deleteError = ApiError.Conflict("dirty worktree", sessionCount = null)
        }
        val viewModel = immediateViewModel(sessions = sessions)

        viewModel.selectSession("p1", "build")
        viewModel.requestDeleteSession("p1", session("build"))
        viewModel.confirmPendingDelete()

        val state = viewModel.state.value
        assertEquals("build", state.selectedSessionName)
        val pending = state.pendingDelete as WebShellUiState.PendingDelete.OfSession
        assertTrue(pending.forced)
    }

    @Test
    fun `cancelPendingDelete clears without deleting`() {
        val projects = FakeProjectsRepository(listOf(project()))
        val viewModel = immediateViewModel(projects = projects)

        viewModel.requestDeleteProject(project())
        viewModel.cancelPendingDelete()

        val state = viewModel.state.value
        assertNull(state.pendingDelete)
        assertEquals(listOf(project()), state.projects)
    }

    @Test
    fun `toggleSidebarCollapsed flips the flag`() {
        val viewModel = immediateViewModel()

        assertFalse(viewModel.state.value.sidebarCollapsed)
        viewModel.toggleSidebarCollapsed()
        assertTrue(viewModel.state.value.sidebarCollapsed)
    }
}
