package com.tanyudii.tmuxweb.ui.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.domain.repository.ProjectsRepository
import com.tanyudii.tmuxweb.domain.repository.SessionsRepository
import com.tanyudii.tmuxweb.presentation.SessionListUiState
import com.tanyudii.tmuxweb.presentation.SessionListViewModel
import com.tanyudii.tmuxweb.presentation.deleteHandlingConflict
import com.tanyudii.tmuxweb.ui.components.TmuxButton
import com.tanyudii.tmuxweb.ui.components.TmuxButtonSize
import com.tanyudii.tmuxweb.ui.components.TmuxButtonVariant
import com.tanyudii.tmuxweb.ui.components.TmuxConfirmDialog
import com.tanyudii.tmuxweb.ui.components.TmuxEmptyState
import com.tanyudii.tmuxweb.ui.components.TmuxErrorBanner
import com.tanyudii.tmuxweb.ui.components.TmuxIconButton
import com.tanyudii.tmuxweb.ui.components.TmuxIconButtonSize
import com.tanyudii.tmuxweb.ui.components.TmuxNavBar
import com.tanyudii.tmuxweb.ui.components.TmuxNavBarBack
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxMonoSize
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

@Composable
fun SessionListRoute(
    projectId: String,
    projectName: String,
    projectRepoPath: String,
    onOpenSession: (ProjectSession) -> Unit,
    onBack: () -> Unit,
) {
    val repository: SessionsRepository = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember(projectId) { SessionListViewModel(projectId, repository, scope) }
    val state by viewModel.state.collectAsState()
    var isCreateSheetOpen by remember { mutableStateOf(false) }
    var editingLabelSession by remember { mutableStateOf<ProjectSession?>(null) }
    val deleteProjectState = rememberDeleteProjectState(projectId, onDeleted = onBack)

    SessionListScreen(
        projectName = projectName,
        projectRepoPath = projectRepoPath,
        state = state,
        viewModel = viewModel,
        deleteProjectState = deleteProjectState,
        onOpenSession = onOpenSession,
        onNewSessionClick = { isCreateSheetOpen = true },
        onEditLabel = { session -> editingLabelSession = session },
        onBack = onBack,
    )

    if (isCreateSheetOpen || state.sessionCreation != null) {
        NewSessionSheet(
            creationState = state.sessionCreation,
            onCreate = { name -> isCreateSheetOpen = false; viewModel.createSession(name) },
            onCancel = { isCreateSheetOpen = false; viewModel.cancelSessionCreation() },
        )
    }

    editingLabelSession?.let { session ->
        SessionLabelSheet(
            initialLabel = session.label,
            onSave = { newLabel ->
                viewModel.setSessionMeta(session, newLabel, session.favorite)
                editingLabelSession = null
            },
            onCancel = { editingLabelSession = null },
        )
    }
}

/** Sessions list — ports `ui_kits/ios/app.jsx`'s `SessionsScreen`. */
@Composable
private fun SessionListScreen(
    projectName: String,
    projectRepoPath: String,
    state: SessionListUiState,
    viewModel: SessionListViewModel,
    deleteProjectState: DeleteProjectState,
    onOpenSession: (ProjectSession) -> Unit,
    onNewSessionClick: () -> Unit,
    onEditLabel: (ProjectSession) -> Unit,
    onBack: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize().background(TmuxColors.bgSurface)) {
        TmuxNavBar(
            title = projectName,
            back = TmuxNavBarBack(label = "Projects", onClick = onBack),
            right = {
                if (state.isSelectionMode) {
                    TmuxIconButton(
                        icon = TmuxIcons.Close,
                        contentDescription = "Cancel selection",
                        size = TmuxIconButtonSize.LG,
                        onClick = viewModel.bulkDelete::toggleSelectionMode,
                    )
                } else {
                    TmuxIconButton(
                        icon = TmuxIcons.CheckboxChecked,
                        contentDescription = "Select sessions",
                        size = TmuxIconButtonSize.LG,
                        onClick = viewModel.bulkDelete::toggleSelectionMode,
                    )
                    TmuxIconButton(
                        icon = TmuxIcons.Plus,
                        contentDescription = "New session",
                        size = TmuxIconButtonSize.LG,
                        onClick = onNewSessionClick,
                    )
                }
            },
        )
        Text(
            projectRepoPath,
            color = TmuxColors.textTertiary,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxMonoSize.xs,
            modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 4.dp),
        )
        state.errorMessage?.let { message ->
            TmuxErrorBanner(message = message, onDismiss = viewModel::dismissError)
        }
        deleteProjectState.errorMessage?.let { message ->
            TmuxErrorBanner(message = message, onDismiss = deleteProjectState::dismissError)
        }
        SessionsBody(
            state = state,
            viewModel = viewModel,
            deleteProjectState = deleteProjectState,
            onOpenSession = onOpenSession,
            onEditLabel = onEditLabel,
            modifier = Modifier.weight(1f),
        )
    }

    SessionListConfirmDialogs(state = state, viewModel = viewModel, deleteProjectState = deleteProjectState)
}

/**
 * The scrollable body below the nav bar/banners — split out of
 * [SessionListScreen] purely to keep that composable's line count under
 * the project's threshold — no behavior change.
 */
@Composable
private fun SessionsBody(
    state: SessionListUiState,
    viewModel: SessionListViewModel,
    deleteProjectState: DeleteProjectState,
    onOpenSession: (ProjectSession) -> Unit,
    onEditLabel: (ProjectSession) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.verticalScroll(rememberScrollState()).padding(top = 8.dp)) {
        state.sessionCreation?.let { creation -> CreatingSessionCard(creation.progressMessage) }
        if (state.sessions.isNotEmpty()) {
            SessionFilterBar(state, viewModel)
        }
        val visibleSessions = state.filteredSessions
        when {
            state.sessions.isEmpty() && state.sessionCreation == null -> {
                TmuxEmptyState(
                    icon = TmuxIcons.Terminal,
                    title = "No active sessions",
                    subtitle = "Tap + to start one.",
                    titleColor = TmuxColors.textPrimary,
                    titleSize = TmuxTextSize.base,
                )
            }
            visibleSessions.isEmpty() -> {
                TmuxEmptyState(
                    icon = TmuxIcons.Terminal,
                    title = "No sessions match filters",
                    subtitle = "Try a different status or branch.",
                    titleColor = TmuxColors.textPrimary,
                    titleSize = TmuxTextSize.base,
                )
            }
            else -> SessionsSections(visibleSessions, state, viewModel, onOpenSession, onEditLabel)
        }
        if (state.isSelectionMode) {
            BulkDeleteBar(state, viewModel)
        }
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            TmuxButton(
                onClick = { deleteProjectState.requestDelete(state.sessions.any { it.attached }) },
                text = "Delete project",
                variant = TmuxButtonVariant.DANGER_GHOST,
                size = TmuxButtonSize.SM,
                icon = TmuxIcons.Trash,
            )
        }
    }
}

/**
 * Force-delete-session and delete-project confirm dialogs — split out of
 * [SessionListScreen] purely to keep that composable's line count under
 * the project's threshold — no behavior change.
 */
@Composable
private fun SessionListConfirmDialogs(
    state: SessionListUiState,
    viewModel: SessionListViewModel,
    deleteProjectState: DeleteProjectState,
) {
    state.pendingForceDelete?.let { pending ->
        TmuxConfirmDialog(
            title = "Delete session?",
            message = pending.message,
            force = true,
            onConfirm = viewModel::confirmForceDelete,
            onCancel = viewModel::cancelForceDelete,
        )
    }
    state.pendingBulkDelete?.let { pending ->
        TmuxConfirmDialog(
            title = "Delete ${pending.names.size} session(s)?",
            message = "This closes ${pending.names.size} session(s) and removes their worktrees.",
            onConfirm = viewModel.bulkDelete::confirmBulkDelete,
            onCancel = viewModel.bulkDelete::cancelBulkDelete,
        )
    }
    state.pendingBulkForceDelete?.let { pending ->
        TmuxConfirmDialog(
            title = "Force delete ${pending.sessions.size} session(s)?",
            message = "These have uncommitted changes or are still active -- deleting force-closes them.",
            force = true,
            onConfirm = viewModel.bulkDelete::confirmBulkForceDelete,
            onCancel = viewModel.bulkDelete::cancelBulkForceDelete,
            content = {
                pending.sessions.forEach { session ->
                    Text(
                        session.name,
                        color = TmuxColors.textSecondary,
                        fontFamily = TmuxFonts.mono,
                        fontSize = TmuxMonoSize.sm,
                    )
                }
            },
        )
    }
    deleteProjectState.pendingForceMessage?.let { message ->
        TmuxConfirmDialog(
            title = "Delete project?",
            message = message,
            force = true,
            onConfirm = deleteProjectState::confirmForceDelete,
            onCancel = deleteProjectState::cancel,
        )
    }
}

/**
 * Small, self-contained "delete this project" action for the Sessions
 * screen's bottom button — ports the same affordance from
 * `ui_kits/ios/app.jsx`'s `SessionsScreen`. Deliberately not folded into
 * [SessionListViewModel] (which only owns *session* CRUD for one project):
 * this talks to [ProjectsRepository] directly, the same minimal-plumbing
 * pattern already used by `RepoPathPicker`/`WebShellScreen` for one-off
 * repository calls from the UI layer. Navigation always rebuilds a fresh
 * [com.tanyudii.tmuxweb.presentation.ProjectListViewModel] on re-entry to
 * the Projects screen (see its own `init { load() }` and how
 * `ProjectListRoute` constructs it via `remember`), so there is no stale
 * sibling-screen state to reconcile here after a delete.
 */
internal class DeleteProjectState(
    private val projectId: String,
    private val repository: ProjectsRepository,
    private val scope: CoroutineScope,
    private val onDeleted: () -> Unit,
) {
    var pendingForceMessage by mutableStateOf<String?>(null)
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set

    fun requestDelete(hasAttachedSessions: Boolean) {
        if (hasAttachedSessions) {
            pendingForceMessage = "Active sessions will be killed."
        } else {
            delete(force = false)
        }
    }

    fun confirmForceDelete() {
        pendingForceMessage = null
        delete(force = true)
    }

    fun cancel() {
        pendingForceMessage = null
    }

    fun dismissError() {
        errorMessage = null
    }

    private fun delete(force: Boolean) {
        scope.launch {
            deleteHandlingConflict(
                delete = { repository.deleteProject(projectId, force) },
                onSuccess = { onDeleted() },
                onConflict = { message -> pendingForceMessage = message },
                onError = { message -> errorMessage = message },
            )
        }
    }
}

@Composable
private fun rememberDeleteProjectState(projectId: String, onDeleted: () -> Unit): DeleteProjectState {
    val repository: ProjectsRepository = koinInject()
    val scope = rememberCoroutineScope()
    return remember(projectId) { DeleteProjectState(projectId, repository, scope, onDeleted) }
}
