package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.domain.model.ChangedFile
import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.GroupedChanges
import com.tanyudii.tmuxweb.domain.repository.ChangesRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Ports ChangesListView.swift's 5s poll loop — see plan §2.6's poll-interval
 * table (kept as-is, tested with virtual time instead of real delays).
 */
data class ChangesUiState(
    val changes: GroupedChanges? = null,
    val errorMessage: String? = null,
    // Set by requestDiscard() while a destructive discard awaits the
    // TmuxConfirmDialog in ChangesRail's host -- see EMB-204. Stage/unstage
    // are non-destructive (reversible with the counterpart action) so they
    // fire immediately without this confirmation step.
    val pendingDiscard: PendingDiscard? = null,
)

data class PendingDiscard(val file: ChangedFile, val mode: DiffMode)

class ChangesViewModel(
    private val projectId: String,
    private val sessionName: String,
    private val repository: ChangesRepository,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(ChangesUiState())
    val state: StateFlow<ChangesUiState> = _state.asStateFlow()

    init {
        scope.launch {
            while (isActive) {
                load()
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    /** Pull-to-refresh — an immediate one-shot reload that does not reset the poll cadence. */
    fun refresh() {
        scope.launch { load() }
    }

    fun dismissError() {
        _state.update { it.copy(errorMessage = null) }
    }

    fun stage(file: ChangedFile) {
        scope.launch {
            runSuspendCatching { repository.stage(projectId, sessionName, file.path) }
                .onSuccess { load() }
                .onFailure { error -> _state.update { it.copy(errorMessage = error.toUiMessage()) } }
        }
    }

    fun unstage(file: ChangedFile) {
        scope.launch {
            runSuspendCatching { repository.unstage(projectId, sessionName, file.path) }
                .onSuccess { load() }
                .onFailure { error -> _state.update { it.copy(errorMessage = error.toUiMessage()) } }
        }
    }

    /** Discard is destructive and irreversible, so it waits for confirmDiscard() rather than firing immediately. */
    fun requestDiscard(file: ChangedFile, mode: DiffMode) {
        _state.update { it.copy(pendingDiscard = PendingDiscard(file, mode)) }
    }

    fun cancelDiscard() {
        _state.update { it.copy(pendingDiscard = null) }
    }

    fun confirmDiscard() {
        val pending = _state.value.pendingDiscard ?: return
        scope.launch {
            runSuspendCatching { repository.discard(projectId, sessionName, pending.file.path, pending.mode) }
                .onSuccess {
                    _state.update { it.copy(pendingDiscard = null) }
                    load()
                }
                .onFailure { error -> _state.update { it.copy(pendingDiscard = null, errorMessage = error.toUiMessage()) } }
        }
    }

    private suspend fun load() {
        runSuspendCatching { repository.changes(projectId, sessionName) }
            .onSuccess { changes -> _state.update { it.copy(changes = changes, errorMessage = null) } }
            .onFailure { error -> _state.update { it.copy(errorMessage = error.toUiMessage()) } }
    }

    private companion object {
        const val POLL_INTERVAL_MS = 5000L
    }
}
