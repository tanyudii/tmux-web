package com.tanyudii.tmuxweb.presentation

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
)

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

    private suspend fun load() {
        runSuspendCatching { repository.changes(projectId, sessionName) }
            .onSuccess { changes -> _state.update { it.copy(changes = changes, errorMessage = null) } }
            .onFailure { error -> _state.update { it.copy(errorMessage = error.toUiMessage()) } }
    }

    private companion object {
        const val POLL_INTERVAL_MS = 5000L
    }
}
