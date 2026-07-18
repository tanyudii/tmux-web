package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.SessionStatusFilter
import com.tanyudii.tmuxweb.domain.filterSessions
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
    // EMB-221: bulk select/delete + filter state.
    val isSelectionMode: Boolean = false,
    val selectedNames: Set<String> = emptySet(),
    val statusFilter: SessionStatusFilter = SessionStatusFilter.ALL,
    val branchQuery: String = "",
    val pendingBulkDelete: PendingBulkDelete? = null,
    val pendingBulkForceDelete: PendingBulkForceDelete? = null,
) {
    /** Set on 409 — the session's worktree has uncommitted changes; see ApiError.Conflict. */
    data class PendingForceDelete(val session: ProjectSession, val message: String)

    /** Names selected for bulk delete, about to show the first (non-force) confirmation. */
    data class PendingBulkDelete(val names: Set<String>)

    /**
     * Sessions that conflicted (409) on the first bulk-delete pass. Kept
     * separate from [PendingBulkDelete] so a bulk action never silently
     * force-deletes a session with uncommitted changes or still attached --
     * only sessions that actually conflicted get a second, explicit
     * force-delete confirmation; everything else was already deleted in
     * the first pass.
     */
    data class PendingBulkForceDelete(val sessions: List<ProjectSession>)

    /** EMB-221: derived, real-time view of [sessions] under the active filters. */
    val filteredSessions: List<ProjectSession>
        get() = filterSessions(sessions, statusFilter, branchQuery)
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

    fun setStatusFilter(filter: SessionStatusFilter) {
        _state.update { it.copy(statusFilter = filter) }
    }

    fun setBranchQuery(query: String) {
        _state.update { it.copy(branchQuery = query) }
    }

    /**
     * EMB-222: sets (or clears, when label is null and favorite is false) a
     * session's label/favorite flag. Optimistically applies the same values
     * to the matching session in [state] on success rather than reloading
     * the whole list -- label/favorite are the only fields this ever
     * changes, so a targeted `copy` is safe and avoids an extra round trip.
     */
    fun setSessionMeta(session: ProjectSession, label: String?, favorite: Boolean) {
        scope.launch {
            runSuspendCatching { repository.setSessionMeta(projectId, session.name, label, favorite) }
                .onSuccess {
                    _state.update { state ->
                        state.copy(
                            sessions = state.sessions.map {
                                if (it.name == session.name) it.copy(label = label, favorite = favorite) else it
                            },
                        )
                    }
                }
                .onFailure { error -> _state.update { it.copy(errorMessage = error.toUiMessage()) } }
        }
    }

    /**
     * EMB-221 bulk select/delete, exposed as a property (not delegated
     * one-liner methods) purely to keep this class under the project's
     * detekt TooManyFunctions threshold -- see [SessionBulkDeleteController]'s
     * own doc comment for the behavior itself. It shares this ViewModel's
     * own `_state`/`removeSession`, not a copy, so its updates are visible
     * through the same [state] callers already collect.
     */
    val bulkDelete: SessionBulkDeleteController = SessionBulkDeleteController(
        projectId = projectId,
        repository = repository,
        scope = scope,
        state = _state,
        removeSession = ::removeSession,
    )

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

/**
 * EMB-221: bulk select/delete for the session list, split out of
 * [SessionListViewModel] purely to keep that class under the project's
 * detekt TooManyFunctions threshold -- no behavior change. Operates
 * directly on the [MutableStateFlow] [SessionListViewModel] itself exposes
 * (passed in, not copied), so every update here is visible through the
 * same `state` StateFlow callers already collect.
 *
 * The two-pass delete/force-delete split is the load-bearing behavior:
 * [confirmBulkDelete] deletes every selected session WITHOUT force, one at
 * a time (sequential, so [removeSession]'s state updates never race).
 * Sessions that come back with a 409 conflict are collected into
 * [SessionListUiState.PendingBulkForceDelete] rather than retried with
 * force in the same pass -- bulk delete must never silently force-delete a
 * session with uncommitted changes or one that's still attached; only
 * sessions that actually conflicted get a second, explicit force-delete
 * confirmation via [confirmBulkForceDelete].
 */
class SessionBulkDeleteController(
    private val projectId: String,
    private val repository: SessionsRepository,
    private val scope: CoroutineScope,
    private val state: MutableStateFlow<SessionListUiState>,
    private val removeSession: (String) -> Unit,
) {
    fun toggleSelectionMode() {
        state.update {
            if (it.isSelectionMode) it.copy(isSelectionMode = false, selectedNames = emptySet())
            else it.copy(isSelectionMode = true)
        }
    }

    fun toggleSessionSelected(name: String) {
        state.update {
            val selected = it.selectedNames
            it.copy(selectedNames = if (name in selected) selected - name else selected + name)
        }
    }

    fun requestBulkDelete() {
        val names = state.value.selectedNames
        if (names.isEmpty()) return
        state.update { it.copy(pendingBulkDelete = SessionListUiState.PendingBulkDelete(names)) }
    }

    fun cancelBulkDelete() {
        state.update { it.copy(pendingBulkDelete = null) }
    }

    fun confirmBulkDelete() {
        val pending = state.value.pendingBulkDelete ?: return
        state.update { it.copy(pendingBulkDelete = null) }
        scope.launch {
            val conflicted = mutableListOf<ProjectSession>()
            for (name in pending.names) {
                val session = state.value.sessions.find { it.name == name } ?: continue
                deleteHandlingConflict(
                    delete = { repository.deleteSession(projectId, name) },
                    onSuccess = {
                        removeSession(name)
                        state.update { it.copy(selectedNames = it.selectedNames - name) }
                    },
                    onConflict = { conflicted += session },
                    onError = { message -> state.update { it.copy(errorMessage = message) } },
                )
            }
            state.update {
                it.copy(
                    isSelectionMode = conflicted.isNotEmpty(),
                    pendingBulkForceDelete = conflicted.takeIf { list -> list.isNotEmpty() }
                        ?.let(SessionListUiState::PendingBulkForceDelete),
                )
            }
        }
    }

    /**
     * Declining to force-delete the conflicting sessions leaves them alone,
     * same as [SessionListViewModel.cancelForceDelete].
     */
    fun cancelBulkForceDelete() {
        state.update { it.copy(pendingBulkForceDelete = null, isSelectionMode = false, selectedNames = emptySet()) }
    }

    fun confirmBulkForceDelete() {
        val pending = state.value.pendingBulkForceDelete ?: return
        state.update { it.copy(pendingBulkForceDelete = null) }
        scope.launch {
            for (session in pending.sessions) {
                deleteHandlingConflict(
                    delete = { repository.deleteSession(projectId, session.name, force = true) },
                    onSuccess = {
                        removeSession(session.name)
                        state.update { it.copy(selectedNames = it.selectedNames - session.name) }
                    },
                    onConflict = { message -> state.update { it.copy(errorMessage = message) } },
                    onError = { message -> state.update { it.copy(errorMessage = message) } },
                )
            }
            state.update { it.copy(isSelectionMode = false) }
        }
    }
}
