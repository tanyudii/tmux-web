package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.domain.model.SessionResourceUsage
import com.tanyudii.tmuxweb.domain.repository.SessionResourceUsageRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * EMB-214: polls this session's CPU/mem every 5s -- same cadence as
 * [ChangesViewModel]'s git-changes poll. Silent-fail like
 * [EnvironmentViewModel]'s status poll: a transient hiccup every 5s must
 * never pop an error banner over the terminal, it just leaves the last
 * good reading on screen until the next successful poll.
 */
class SessionResourceUsageViewModel(
    private val projectId: String,
    private val sessionName: String,
    private val repository: SessionResourceUsageRepository,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow<SessionResourceUsage?>(null)
    val state: StateFlow<SessionResourceUsage?> = _state.asStateFlow()

    init {
        scope.launch {
            while (isActive) {
                refresh()
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    private suspend fun refresh() {
        runSuspendCatching { repository.getUsage(projectId, sessionName) }
            .onSuccess { usage -> _state.update { usage } }
    }

    private companion object {
        const val POLL_INTERVAL_MS = 5000L
    }
}
