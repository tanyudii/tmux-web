package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.domain.ParsedDiff
import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.FileDiff
import com.tanyudii.tmuxweb.domain.parseUnifiedDiff
import com.tanyudii.tmuxweb.domain.parsedDiffFromAdditions
import com.tanyudii.tmuxweb.domain.repository.ChangesRepository
import com.tanyudii.tmuxweb.domain.withIntralineHighlights
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DiffUiState(
    val isLoading: Boolean = true,
    val parsedDiff: ParsedDiff? = null,
    val isBinary: Boolean = false,
    val isUntracked: Boolean = false,
    val errorMessage: String? = null,
)

/**
 * Loads and parses the diff for one changed file — the data behind
 * `TmuxDiffDialog`. One-shot on init (no polling, unlike [ChangesViewModel]);
 * a fresh instance is created per dialog open via `remember(file, mode)`,
 * mirroring [DirectoryPickerViewModel]'s one-shot load pattern.
 */
class DiffViewModel(
    private val projectId: String,
    private val sessionName: String,
    private val filePath: String,
    private val mode: DiffMode,
    private val repository: ChangesRepository,
    scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(DiffUiState())
    val state: StateFlow<DiffUiState> = _state.asStateFlow()

    init {
        scope.launch { load() }
    }

    private suspend fun load() {
        runSuspendCatching { repository.diff(projectId, sessionName, filePath, mode) }
            .onSuccess { fileDiff ->
                _state.update {
                    it.copy(
                        isLoading = false,
                        parsedDiff = parse(fileDiff),
                        isBinary = fileDiff.isBinary,
                        isUntracked = fileDiff.isUntracked,
                        errorMessage = null,
                    )
                }
            }
            .onFailure { error -> _state.update { it.copy(isLoading = false, errorMessage = error.toUiMessage()) } }
    }

    private fun parse(fileDiff: FileDiff): ParsedDiff? = when {
        fileDiff.isBinary -> null
        fileDiff.isUntracked -> parsedDiffFromAdditions(fileDiff.diff)
        else -> withIntralineHighlights(parseUnifiedDiff(fileDiff.diff))
    }
}
