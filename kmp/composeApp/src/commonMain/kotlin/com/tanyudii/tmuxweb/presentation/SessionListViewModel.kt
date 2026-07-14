package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.domain.model.SessionCreationPhase
import com.tanyudii.tmuxweb.domain.repository.SessionsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Ports SessionListView.swift's `@State` machine 1:1 — see plan §2.2's session CRUD endpoints. */
data class SessionListUiState(
    val sessions: List<ProjectSession> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val pendingForceDelete: PendingForceDelete? = null,
    val sessionCreation: SessionCreationUiState? = null,
) {
    /** Set on 409 — the session's worktree has uncommitted changes; see ApiError.Conflict. */
    data class PendingForceDelete(val session: ProjectSession, val message: String)
}

/**
 * Ports NewSessionSheet.swift's 1s creation-progress poll — see plan §5's
 * "session-creation progress polling" feature-parity item. `null` on
 * [SessionListUiState] means "no sheet open"; non-null with `errorMessage`
 * set means "sheet open, showing an error, waiting for Cancel."
 */
data class SessionCreationUiState(
    val isSaving: Boolean = true,
    val progressMessage: String? = null,
    val errorMessage: String? = null,
)

class SessionListViewModel(
    private val projectId: String,
    private val repository: SessionsRepository,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(SessionListUiState())
    val state: StateFlow<SessionListUiState> = _state.asStateFlow()
    private var creationJob: Job? = null

    init {
        load()
    }

    fun load() {
        scope.launch {
            _state.update { it.copy(isLoading = true) }
            runSuspendCatching { repository.listSessions(projectId) }
                .onSuccess { sessions -> _state.update { it.copy(isLoading = false, sessions = sessions) } }
                .onFailure { error -> _state.update { it.copy(isLoading = false, errorMessage = error.toUiMessage()) } }
        }
    }

    fun delete(session: ProjectSession) {
        scope.launch {
            runSuspendCatching { repository.deleteSession(projectId, session.name) }
                .onSuccess { removeSession(session.name) }
                .onFailure { error ->
                    if (error is ApiError.Conflict) {
                        val pending = SessionListUiState.PendingForceDelete(session, error.serverMessage)
                        _state.update { it.copy(pendingForceDelete = pending) }
                    } else {
                        _state.update { it.copy(errorMessage = error.toUiMessage()) }
                    }
                }
        }
    }

    fun confirmForceDelete() {
        val pending = _state.value.pendingForceDelete ?: return
        _state.update { it.copy(pendingForceDelete = null) }
        scope.launch {
            runSuspendCatching { repository.deleteSession(projectId, pending.session.name, force = true) }
                .onSuccess { removeSession(pending.session.name) }
                .onFailure { error -> _state.update { it.copy(errorMessage = error.toUiMessage()) } }
        }
    }

    fun cancelForceDelete() {
        _state.update { it.copy(pendingForceDelete = null) }
    }

    fun dismissError() {
        _state.update { it.copy(errorMessage = null) }
    }

    fun createSession(name: String) {
        creationJob?.cancel()
        _state.update { it.copy(sessionCreation = SessionCreationUiState()) }
        creationJob = scope.launch {
            runSuspendCatching { repository.startSessionCreation(projectId, name) }
                .onSuccess { pending -> pollCreationStatus(pending.name) }
                .onFailure { error -> failCreation(error.toUiMessage()) }
        }
    }

    fun cancelSessionCreation() {
        creationJob?.cancel()
        _state.update { it.copy(sessionCreation = null) }
    }

    private suspend fun pollCreationStatus(sessionSlug: String) {
        var polling = true
        while (polling) {
            val result = runSuspendCatching { repository.sessionCreationStatus(projectId, sessionSlug) }
            val status = result.getOrNull()
            if (status == null) {
                failCreation(result.exceptionOrNull()?.toUiMessage() ?: "Session creation failed.")
                return
            }
            _state.update { it.copy(sessionCreation = it.sessionCreation?.copy(progressMessage = status.message)) }
            when (status.phase) {
                SessionCreationPhase.READY -> {
                    val newSession = status.session
                    _state.update {
                        it.copy(
                            sessionCreation = null,
                            sessions = if (newSession != null) it.sessions + newSession else it.sessions,
                        )
                    }
                    polling = false
                }
                SessionCreationPhase.ERROR -> {
                    failCreation(status.message ?: "Session creation failed.")
                    polling = false
                }
                SessionCreationPhase.CREATING -> delay(SESSION_CREATION_POLL_INTERVAL_MS)
            }
        }
    }

    private fun failCreation(message: String) {
        val current = _state.value.sessionCreation ?: SessionCreationUiState()
        _state.update { it.copy(sessionCreation = current.copy(isSaving = false, errorMessage = message)) }
    }

    private fun removeSession(name: String) {
        _state.update { state -> state.copy(sessions = state.sessions.filterNot { it.name == name }) }
    }

    private companion object {
        const val SESSION_CREATION_POLL_INTERVAL_MS = 1000L
    }
}
