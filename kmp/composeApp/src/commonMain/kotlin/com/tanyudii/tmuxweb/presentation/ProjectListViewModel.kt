package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.Project
import com.tanyudii.tmuxweb.domain.repository.ProjectsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Ports ProjectListView.swift's `@State` machine 1:1 — see plan §2.2's project CRUD endpoints. */
data class ProjectListUiState(
    val projects: List<Project> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val pendingForceDelete: PendingForceDelete? = null,
    // null = sheet closed. Mirrors NewProjectSheet.swift's own @State, kept
    // here (not in the composable) so it's unit-testable like every other
    // mutation on this ViewModel — see SessionListViewModel.createSession
    // for the equivalent pattern this was modeled after.
    val newProject: NewProjectUiState? = null,
) {
    /** Set on 409 — the project still has active sessions; see ApiError.Conflict. */
    data class PendingForceDelete(val project: Project, val message: String)

    data class NewProjectUiState(val isSaving: Boolean = false, val errorMessage: String? = null)
}

class ProjectListViewModel(
    private val repository: ProjectsRepository,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(ProjectListUiState())
    val state: StateFlow<ProjectListUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        scope.launch {
            _state.update { it.copy(isLoading = true) }
            runSuspendCatching { repository.listProjects() }
                .onSuccess { projects -> _state.update { it.copy(isLoading = false, projects = projects) } }
                .onFailure { error -> _state.update { it.copy(isLoading = false, errorMessage = error.toUiMessage()) } }
        }
    }

    fun addProject(project: Project) {
        _state.update { it.copy(projects = it.projects + project) }
    }

    fun showNewProjectSheet() {
        _state.update { it.copy(newProject = ProjectListUiState.NewProjectUiState()) }
    }

    fun cancelNewProject() {
        _state.update { it.copy(newProject = null) }
    }

    fun createProject(name: String, repoPath: String) {
        _state.update { it.copy(newProject = ProjectListUiState.NewProjectUiState(isSaving = true)) }
        scope.launch {
            runSuspendCatching { repository.createProject(name, repoPath) }
                .onSuccess { project ->
                    addProject(project)
                    _state.update { it.copy(newProject = null) }
                }
                .onFailure { error ->
                    val message = error.toUiMessage()
                    _state.update { it.copy(newProject = ProjectListUiState.NewProjectUiState(errorMessage = message)) }
                }
        }
    }

    fun delete(project: Project) {
        scope.launch {
            runSuspendCatching { repository.deleteProject(project.id) }
                .onSuccess { removeProject(project.id) }
                .onFailure { error -> handleDeleteFailure(project, error) }
        }
    }

    fun confirmForceDelete() {
        val pending = _state.value.pendingForceDelete ?: return
        _state.update { it.copy(pendingForceDelete = null) }
        scope.launch {
            runSuspendCatching { repository.deleteProject(pending.project.id, force = true) }
                .onSuccess { removeProject(pending.project.id) }
                .onFailure { error -> _state.update { it.copy(errorMessage = error.toUiMessage()) } }
        }
    }

    fun cancelForceDelete() {
        _state.update { it.copy(pendingForceDelete = null) }
    }

    fun dismissError() {
        _state.update { it.copy(errorMessage = null) }
    }

    private fun handleDeleteFailure(project: Project, error: Throwable) {
        if (error is ApiError.Conflict) {
            _state.update {
                it.copy(pendingForceDelete = ProjectListUiState.PendingForceDelete(project, error.serverMessage))
            }
        } else {
            _state.update { it.copy(errorMessage = error.toUiMessage()) }
        }
    }

    private fun removeProject(id: String) {
        _state.update { state -> state.copy(projects = state.projects.filterNot { it.id == id }) }
    }
}
