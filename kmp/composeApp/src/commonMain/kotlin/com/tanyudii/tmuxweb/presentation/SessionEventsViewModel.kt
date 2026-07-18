package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.domain.model.SessionEvent
import com.tanyudii.tmuxweb.domain.repository.SessionEventsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SessionEventsUiState(
    val events: List<SessionEvent> = emptyList(),
    val isLoading: Boolean = true,
    val errorMessage: String? = null,
)

/**
 * Backs the read-only session-events dialog (EMB-213) reachable from a
 * session's [com.tanyudii.tmuxweb.ui.web.WebMainPane] top bar.
 */
class SessionEventsViewModel(
    private val projectId: String,
    private val sessionName: String,
    private val repository: SessionEventsRepository,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(SessionEventsUiState())
    val state: StateFlow<SessionEventsUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _state.update { it.copy(isLoading = true, errorMessage = null) }
        scope.launch {
            runSuspendCatching { repository.listEvents(projectId, sessionName) }
                .onSuccess { events -> _state.update { it.copy(events = events, isLoading = false) } }
                .onFailure { error -> _state.update { it.copy(isLoading = false, errorMessage = error.toUiMessage()) } }
        }
    }
}
