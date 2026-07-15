package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.domain.model.DirectoryEntry
import com.tanyudii.tmuxweb.domain.repository.BrowseRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DirectoryPickerUiState(
    val currentPath: String? = null,
    val parentPath: String? = null,
    val isCurrentGitRepo: Boolean = false,
    val entries: List<DirectoryEntry> = emptyList(),
    val truncated: Boolean = false,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
)

/**
 * Drives the "choose a repo folder" picker (GET /api/browse) — ports the old
 * iOS DirectoryBrowserView.swift's navigation model into a shared,
 * unit-tested ViewModel. A failed [open]/[up]/[retry] leaves the previously
 * loaded listing in place (only [errorMessage] changes) so a permission
 * error on one folder doesn't strand the user with an empty screen.
 */
class DirectoryPickerViewModel(
    private val repository: BrowseRepository,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(DirectoryPickerUiState())
    val state: StateFlow<DirectoryPickerUiState> = _state.asStateFlow()
    private var lastRequestedPath: String? = null

    init {
        load(null)
    }

    fun open(entry: DirectoryEntry) {
        load(entry.path)
    }

    fun up() {
        state.value.parentPath?.let(::load)
    }

    /** Re-issues the last attempted [open]/[up]/initial request, e.g. after a transient failure. */
    fun retry() {
        load(lastRequestedPath)
    }

    private fun load(path: String?) {
        lastRequestedPath = path
        scope.launch {
            _state.update { it.copy(isLoading = true, errorMessage = null) }
            runSuspendCatching { repository.browse(path) }
                .onSuccess { listing ->
                    _state.update {
                        it.copy(
                            currentPath = listing.path,
                            parentPath = listing.parentPath,
                            isCurrentGitRepo = listing.isGitRepo,
                            entries = listing.entries,
                            truncated = listing.truncated,
                            isLoading = false,
                            errorMessage = null,
                        )
                    }
                }
                .onFailure { error -> _state.update { it.copy(isLoading = false, errorMessage = error.toUiMessage()) } }
        }
    }
}
