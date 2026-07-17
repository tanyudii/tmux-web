package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.Project
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.domain.model.SessionCreationPhase
import com.tanyudii.tmuxweb.domain.model.SessionTemplate
import com.tanyudii.tmuxweb.domain.repository.ProjectsRepository
import com.tanyudii.tmuxweb.domain.repository.SessionTemplatesRepository
import com.tanyudii.tmuxweb.domain.repository.SessionsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Drives the Web shell's persistent sidebar (project -> session tree) and
 * master-detail selection. This is a different data shape from the mobile
 * drill-down screens (`ProjectListViewModel`/`SessionListViewModel`), which
 * load one project's sessions at a time behind nav-route args — here
 * multiple projects' sessions can be expanded and visible at once, so this
 * owns its own tree state rather than composing those two. Ports the
 * interaction model in the design-system handoff's `ui_kits/web/app.jsx`.
 */
data class WebShellUiState(
    val projects: List<Project> = emptyList(),
    val isLoadingProjects: Boolean = false,
    val expandedProjectIds: Set<String> = emptySet(),
    val sessionsByProjectId: Map<String, List<ProjectSession>> = emptyMap(),
    val loadingSessionsForProjectIds: Set<String> = emptySet(),
    val selectedProjectId: String? = null,
    val selectedSessionName: String? = null,
    val sidebarCollapsed: Boolean = false,
    val errorMessage: String? = null,
    val newProjectDialog: NewProjectDialogUiState? = null,
    val newSessionDialog: NewSessionDialogUiState? = null,
    val pendingDelete: PendingDelete? = null,
) {
    data class NewProjectDialogUiState(val isSaving: Boolean = false, val errorMessage: String? = null)

    data class NewSessionDialogUiState(
        val projectId: String,
        val isSaving: Boolean = true,
        val progressMessage: String? = null,
        val errorMessage: String? = null,
        // EMB-220: this project's saved session templates, offered as
        // one-click name/startup-command fill-ins -- loaded once when the
        // dialog opens (see showNewSessionDialog), not re-fetched on every
        // keystroke.
        val templates: List<SessionTemplate> = emptyList(),
    )

    sealed interface PendingDelete {
        val forced: Boolean

        data class OfProject(
            val project: Project,
            override val forced: Boolean,
            val message: String? = null,
        ) : PendingDelete

        data class OfSession(
            val projectId: String,
            val session: ProjectSession,
            override val forced: Boolean,
            val message: String? = null,
            // EMB-207: "Delete branch too" checkbox state. deleteBranch is
            // the checkbox's own checked state; branchMergeChecked/
            // branchMerged track the async merge-status lookup triggered by
            // checking it (see setDeleteBranchOnSessionDelete);
            // unmergedConfirmed is the *second* confirmation tier -- the
            // first Confirm click while the branch is known-unmerged just
            // sets this instead of actually deleting, escalating the
            // dialog's own warning, mirroring how `forced` already escalates
            // for a worktree/session conflict.
            val deleteBranch: Boolean = false,
            val branchMergeChecked: Boolean = false,
            val branchMerged: Boolean? = null,
            val unmergedConfirmed: Boolean = false,
        ) : PendingDelete
    }

    /**
     * True while any modal (new project/session, pending delete) is shown —
     * see [com.tanyudii.tmuxweb.terminal.PlatformTerminalView]'s `isVisible`
     * kdoc for why the web shell needs this to hide the terminal's native
     * DOM element for the duration instead of letting it paint over the dialog.
     */
    val hasOpenDialog: Boolean
        get() = newProjectDialog != null || newSessionDialog != null || pendingDelete != null

    val selectedProject: Project?
        get() = projects.find { it.id == selectedProjectId }

    val selectedSession: ProjectSession?
        get() {
            val projectId = selectedProjectId ?: return null
            val name = selectedSessionName ?: return null
            return sessionsByProjectId[projectId]?.find { it.name == name }
        }
}

// This screen legitimately merges what would be 2-3 mobile ViewModels' worth
// of responsibility (project tree + session tree + two dialog kinds + two
// force-delete kinds) into one — see the equivalent TooManyFunctions note
// in config/detekt/detekt.yml. Splitting it would fragment one cohesive
// piece of screen state across several files without reducing complexity.
@Suppress("TooManyFunctions")
class WebShellViewModel(
    private val projectsRepository: ProjectsRepository,
    private val sessionsRepository: SessionsRepository,
    private val templatesRepository: SessionTemplatesRepository,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(WebShellUiState())
    val state: StateFlow<WebShellUiState> = _state.asStateFlow()
    private var sessionCreationJob: Job? = null

    init {
        loadProjects()
    }

    fun loadProjects() {
        scope.launch {
            _state.update { it.copy(isLoadingProjects = true) }
            runSuspendCatching { projectsRepository.listProjects() }
                .onSuccess { projects -> _state.update { it.copy(isLoadingProjects = false, projects = projects) } }
                .onFailure { error ->
                    _state.update { it.copy(isLoadingProjects = false, errorMessage = error.toUiMessage()) }
                }
        }
    }

    fun toggleProject(projectId: String) {
        val expanded = _state.value.expandedProjectIds
        val nowExpanded = projectId !in expanded
        _state.update { it.copy(expandedProjectIds = if (nowExpanded) expanded + projectId else expanded - projectId) }
        if (nowExpanded && projectId !in _state.value.sessionsByProjectId) loadSessions(projectId)
    }

    fun selectProject(projectId: String) {
        _state.update { it.copy(selectedProjectId = projectId, selectedSessionName = null) }
        if (projectId !in _state.value.expandedProjectIds) toggleProject(projectId)
    }

    fun selectSession(projectId: String, sessionName: String) {
        _state.update {
            it.copy(
                selectedProjectId = projectId,
                selectedSessionName = sessionName,
                expandedProjectIds = it.expandedProjectIds + projectId,
            )
        }
    }

    fun toggleSidebarCollapsed() {
        _state.update { it.copy(sidebarCollapsed = !it.sidebarCollapsed) }
    }

    /**
     * Eagerly loads sessions for every project not yet expanded -- the
     * command palette (EMB-218) needs a complete, searchable project+session
     * list the moment it opens, unlike the sidebar's own lazy
     * expand-on-click loading (see [toggleProject]). Deliberately does NOT
     * touch [WebShellUiState.expandedProjectIds], so opening the palette
     * never visually expands sidebar rows the user hasn't clicked.
     */
    fun loadAllSessions() {
        val loaded = _state.value.sessionsByProjectId.keys
        _state.value.projects.map { it.id }.filterNot { it in loaded }.forEach(::loadSessions)
    }

    /**
     * Re-fetches one project's session list -- used after sending a tmux
     * `new-window` keystroke, since `ProjectSession.windows` is a plain
     * snapshot from `GET /api/projects/:id/sessions` (src/tmux.ts's
     * `tmux list-sessions`), not something polled while a session is
     * attached. Without this, a newly created window has no way to appear
     * in the tab bar until the user navigates away and back.
     */
    fun refreshSessions(projectId: String) {
        loadSessions(projectId)
    }

    fun showNewProjectDialog() {
        _state.update { it.copy(newProjectDialog = WebShellUiState.NewProjectDialogUiState()) }
    }

    fun cancelNewProjectDialog() {
        _state.update { it.copy(newProjectDialog = null) }
    }

    fun createProject(name: String, repoPath: String) {
        _state.update { it.copy(newProjectDialog = WebShellUiState.NewProjectDialogUiState(isSaving = true)) }
        scope.launch {
            runSuspendCatching { projectsRepository.createProject(name, repoPath) }
                .onSuccess { project ->
                    _state.update { state ->
                        state.copy(
                            projects = state.projects + project,
                            newProjectDialog = null,
                            expandedProjectIds = state.expandedProjectIds + project.id,
                            sessionsByProjectId = state.sessionsByProjectId + (project.id to emptyList()),
                        )
                    }
                }
                .onFailure { error ->
                    _state.update {
                        it.copy(
                            newProjectDialog = WebShellUiState.NewProjectDialogUiState(
                                errorMessage = error.toUiMessage(),
                            ),
                        )
                    }
                }
        }
    }

    /**
     * Opens the new-session dialog in its pre-submit phase (`isSaving =
     * false`) — mirrors NewSessionSheet's local "not yet saving" state.
     */
    fun showNewSessionDialog(projectId: String) {
        sessionCreationJob?.cancel()
        _state.update {
            it.copy(newSessionDialog = WebShellUiState.NewSessionDialogUiState(projectId = projectId, isSaving = false))
        }
        scope.launch {
            runSuspendCatching { templatesRepository.listTemplates(projectId) }
                .onSuccess { templates ->
                    _state.update { state ->
                        state.copy(newSessionDialog = state.newSessionDialog?.copy(templates = templates))
                    }
                }
            // A failed template load must never block session creation itself
            // -- silently leave the dialog's template list empty on failure.
        }
    }

    fun cancelNewSessionDialog() {
        sessionCreationJob?.cancel()
        _state.update { it.copy(newSessionDialog = null) }
    }

    fun createSession(name: String, startupCommand: String? = null) {
        val projectId = _state.value.newSessionDialog?.projectId ?: return
        sessionCreationJob?.cancel()
        _state.update { it.copy(newSessionDialog = WebShellUiState.NewSessionDialogUiState(projectId = projectId)) }
        sessionCreationJob = scope.launch {
            runSuspendCatching { sessionsRepository.startSessionCreation(projectId, name, startupCommand) }
                .onSuccess { pending -> pollSessionCreation(projectId, pending.name) }
                .onFailure { error -> failSessionCreation(projectId, error.toUiMessage()) }
        }
    }

    /** Persists the dialog's current name/startup-command as a reusable template (EMB-220). */
    fun saveAsTemplate(name: String, startupCommand: String?) {
        val projectId = _state.value.newSessionDialog?.projectId ?: return
        scope.launch {
            runSuspendCatching { templatesRepository.createTemplate(projectId, name, startupCommand) }
                .onSuccess { template ->
                    _state.update { state ->
                        val dialog = state.newSessionDialog ?: return@update state
                        state.copy(newSessionDialog = dialog.copy(templates = dialog.templates + template))
                    }
                }
                .onFailure { error ->
                    _state.update { state ->
                        val dialog = state.newSessionDialog ?: return@update state
                        state.copy(newSessionDialog = dialog.copy(errorMessage = error.toUiMessage()))
                    }
                }
        }
    }

    fun deleteTemplate(templateId: String) {
        val projectId = _state.value.newSessionDialog?.projectId ?: return
        scope.launch {
            runSuspendCatching { templatesRepository.deleteTemplate(projectId, templateId) }
                .onSuccess {
                    _state.update { state ->
                        val dialog = state.newSessionDialog ?: return@update state
                        val remaining = dialog.templates.filterNot { it.id == templateId }
                        state.copy(newSessionDialog = dialog.copy(templates = remaining))
                    }
                }
        }
    }

    fun requestDeleteProject(project: Project) {
        _state.update { it.copy(pendingDelete = WebShellUiState.PendingDelete.OfProject(project, forced = false)) }
    }

    fun requestDeleteSession(projectId: String, session: ProjectSession) {
        _state.update {
            it.copy(pendingDelete = WebShellUiState.PendingDelete.OfSession(projectId, session, forced = false))
        }
    }

    fun cancelPendingDelete() {
        _state.update { it.copy(pendingDelete = null) }
    }

    fun confirmPendingDelete() {
        when (val pending = _state.value.pendingDelete ?: return) {
            is WebShellUiState.PendingDelete.OfProject -> deleteProject(pending)
            is WebShellUiState.PendingDelete.OfSession -> {
                val needsUnmergedConfirm = pending.deleteBranch &&
                    pending.branchMergeChecked &&
                    pending.branchMerged == false &&
                    !pending.unmergedConfirmed
                if (needsUnmergedConfirm) {
                    _state.update { it.copy(pendingDelete = pending.copy(unmergedConfirmed = true)) }
                } else {
                    deleteSession(pending)
                }
            }
        }
    }

    /** EMB-207: toggles the session-delete dialog's "Delete branch too" checkbox. */
    fun setDeleteBranchOnSessionDelete(deleteBranch: Boolean) {
        val pending = _state.value.pendingDelete as? WebShellUiState.PendingDelete.OfSession ?: return
        _state.update {
            it.copy(
                pendingDelete = pending.copy(
                    deleteBranch = deleteBranch,
                    branchMergeChecked = false,
                    branchMerged = null,
                    unmergedConfirmed = false,
                ),
            )
        }
        if (!deleteBranch) return
        scope.launch {
            runSuspendCatching { sessionsRepository.isBranchMerged(pending.projectId, pending.session.name) }
                .onSuccess { merged ->
                    _state.update { state ->
                        val current = state.pendingDelete as? WebShellUiState.PendingDelete.OfSession
                            ?: return@update state
                        state.copy(pendingDelete = current.copy(branchMergeChecked = true, branchMerged = merged))
                    }
                }
                .onFailure { error -> _state.update { it.copy(errorMessage = error.toUiMessage()) } }
        }
    }

    fun dismissError() {
        _state.update { it.copy(errorMessage = null) }
    }

    private fun loadSessions(projectId: String) {
        scope.launch {
            _state.update { it.copy(loadingSessionsForProjectIds = it.loadingSessionsForProjectIds + projectId) }
            runSuspendCatching { sessionsRepository.listSessions(projectId) }
                .onSuccess { sessions ->
                    _state.update { state ->
                        state.copy(
                            loadingSessionsForProjectIds = state.loadingSessionsForProjectIds - projectId,
                            sessionsByProjectId = state.sessionsByProjectId + (projectId to sessions),
                        )
                    }
                }
                .onFailure { error ->
                    _state.update { state ->
                        state.copy(
                            loadingSessionsForProjectIds = state.loadingSessionsForProjectIds - projectId,
                            errorMessage = error.toUiMessage(),
                        )
                    }
                }
        }
    }

    private suspend fun pollSessionCreation(projectId: String, sessionSlug: String) {
        var polling = true
        while (polling) {
            val result = runSuspendCatching { sessionsRepository.sessionCreationStatus(projectId, sessionSlug) }
            val status = result.getOrNull()
            if (status == null) {
                failSessionCreation(projectId, result.exceptionOrNull()?.toUiMessage() ?: "Session creation failed.")
                return
            }
            _state.update { state ->
                state.copy(newSessionDialog = state.newSessionDialog?.copy(progressMessage = status.message))
            }
            when (status.phase) {
                SessionCreationPhase.READY -> {
                    applySessionCreated(projectId, status.session)
                    polling = false
                }
                SessionCreationPhase.ERROR -> {
                    failSessionCreation(projectId, status.message ?: "Session creation failed.")
                    polling = false
                }
                SessionCreationPhase.CREATING -> delay(SESSION_CREATION_POLL_INTERVAL_MS)
            }
        }
    }

    private fun applySessionCreated(projectId: String, newSession: ProjectSession?) {
        _state.update { state ->
            val existing = state.sessionsByProjectId[projectId].orEmpty()
            state.copy(
                newSessionDialog = null,
                sessionsByProjectId = if (newSession != null) {
                    state.sessionsByProjectId + (projectId to (existing + newSession))
                } else {
                    state.sessionsByProjectId
                },
                selectedProjectId = projectId,
                selectedSessionName = newSession?.name ?: state.selectedSessionName,
            )
        }
    }

    private fun failSessionCreation(projectId: String, message: String) {
        _state.update { state ->
            val current = state.newSessionDialog ?: WebShellUiState.NewSessionDialogUiState(projectId = projectId)
            state.copy(newSessionDialog = current.copy(isSaving = false, errorMessage = message))
        }
    }

    private fun deleteProject(pending: WebShellUiState.PendingDelete.OfProject) {
        _state.update { it.copy(pendingDelete = null) }
        scope.launch {
            runSuspendCatching { projectsRepository.deleteProject(pending.project.id, force = pending.forced) }
                .onSuccess {
                    _state.update { state ->
                        state.copy(
                            projects = state.projects.filterNot { p -> p.id == pending.project.id },
                            sessionsByProjectId = state.sessionsByProjectId - pending.project.id,
                            selectedProjectId = state.selectedProjectId.takeUnless { it == pending.project.id },
                            selectedSessionName = if (state.selectedProjectId == pending.project.id) {
                                null
                            } else {
                                state.selectedSessionName
                            },
                        )
                    }
                }
                .onFailure { error ->
                    handleDeleteConflict(error) { message ->
                        WebShellUiState.PendingDelete.OfProject(pending.project, forced = true, message = message)
                    }
                }
        }
    }

    private fun deleteSession(pending: WebShellUiState.PendingDelete.OfSession) {
        _state.update { it.copy(pendingDelete = null) }
        scope.launch {
            runSuspendCatching {
                sessionsRepository.deleteSession(
                    pending.projectId,
                    pending.session.name,
                    force = pending.forced,
                    deleteBranch = pending.deleteBranch,
                )
            }
                .onSuccess {
                    _state.update { state ->
                        val remaining = state.sessionsByProjectId[pending.projectId].orEmpty()
                            .filterNot { s -> s.name == pending.session.name }
                        state.copy(
                            sessionsByProjectId = state.sessionsByProjectId + (pending.projectId to remaining),
                            selectedSessionName = state.selectedSessionName.takeUnless { it == pending.session.name },
                        )
                    }
                }
                .onFailure { error ->
                    handleDeleteConflict(error) { message ->
                        pending.copy(forced = true, message = message)
                    }
                }
        }
    }

    private fun handleDeleteConflict(error: Throwable, onConflict: (String) -> WebShellUiState.PendingDelete) {
        if (error is ApiError.Conflict) {
            _state.update { it.copy(pendingDelete = onConflict(error.serverMessage)) }
        } else {
            _state.update { it.copy(errorMessage = error.toUiMessage()) }
        }
    }

    private companion object {
        const val SESSION_CREATION_POLL_INTERVAL_MS = 1000L
    }
}
