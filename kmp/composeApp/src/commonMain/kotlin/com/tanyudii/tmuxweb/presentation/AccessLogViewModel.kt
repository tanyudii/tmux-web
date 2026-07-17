package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.domain.model.AccessLogEntry
import com.tanyudii.tmuxweb.domain.repository.AccessLogRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AccessLogUiState(
    val entries: List<AccessLogEntry> = emptyList(),
    val isLoading: Boolean = true,
    val errorMessage: String? = null,
)

/** Backs the read-only access-log dialog (EMB-223) reachable from the Web sidebar's footer. */
class AccessLogViewModel(private val repository: AccessLogRepository, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow(AccessLogUiState())
    val state: StateFlow<AccessLogUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _state.update { it.copy(isLoading = true, errorMessage = null) }
        scope.launch {
            runSuspendCatching { repository.listEntries() }
                .onSuccess { entries -> _state.update { it.copy(entries = entries, isLoading = false) } }
                .onFailure { error -> _state.update { it.copy(isLoading = false, errorMessage = error.toUiMessage()) } }
        }
    }
}
