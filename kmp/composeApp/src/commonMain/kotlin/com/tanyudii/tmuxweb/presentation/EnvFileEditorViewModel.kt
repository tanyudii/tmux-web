package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.domain.model.EnvFile
import com.tanyudii.tmuxweb.domain.repository.EnvironmentRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Backs the `.tmux-web-env/` file editor dialog opened from
 * [com.tanyudii.tmuxweb.ui.components.TmuxEnvironmentMenu] -- EMB-210.
 * Editing config here never touches a running environment: the user must
 * explicitly re-run Setup afterward (see [EnvironmentViewModel.setup]).
 */
data class EnvFileEditorUiState(
    val files: List<EnvFile> = emptyList(),
    val selectedFilename: String? = null,
    val draftContent: String = "",
    val isLoading: Boolean = true,
    val isSaving: Boolean = false,
    val errorMessage: String? = null,
    val savedFilename: String? = null,
)

class EnvFileEditorViewModel(
    private val projectId: String,
    private val sessionName: String,
    private val repository: EnvironmentRepository,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(EnvFileEditorUiState())
    val state: StateFlow<EnvFileEditorUiState> = _state.asStateFlow()

    init {
        scope.launch { load() }
    }

    private suspend fun load() {
        _state.update { it.copy(isLoading = true, errorMessage = null) }
        runSuspendCatching { repository.listEnvFiles(projectId, sessionName) }
            .onSuccess { files ->
                val selected = _state.value.selectedFilename ?: files.firstOrNull()?.filename
                _state.update {
                    it.copy(
                        files = files,
                        isLoading = false,
                        selectedFilename = selected,
                        draftContent = files.firstOrNull { f -> f.filename == selected }?.content.orEmpty(),
                    )
                }
            }
            .onFailure { error -> _state.update { it.copy(isLoading = false, errorMessage = error.toUiMessage()) } }
    }

    fun selectFile(filename: String) {
        val content = _state.value.files.firstOrNull { it.filename == filename }?.content.orEmpty()
        _state.update { it.copy(selectedFilename = filename, draftContent = content, errorMessage = null) }
    }

    fun updateDraft(content: String) {
        _state.update { it.copy(draftContent = content) }
    }

    fun save() {
        val filename = _state.value.selectedFilename ?: return
        val content = _state.value.draftContent
        _state.update { it.copy(isSaving = true, errorMessage = null, savedFilename = null) }
        scope.launch {
            runSuspendCatching { repository.writeEnvFile(projectId, sessionName, filename, content) }
                .onSuccess {
                    _state.update {
                        it.copy(
                            isSaving = false,
                            savedFilename = filename,
                            files = it.files.map { f -> if (f.filename == filename) f.copy(content = content) else f },
                        )
                    }
                }
                .onFailure { error -> _state.update { it.copy(isSaving = false, errorMessage = error.toUiMessage()) } }
        }
    }

    fun dismissError() {
        _state.update { it.copy(errorMessage = null) }
    }
}
