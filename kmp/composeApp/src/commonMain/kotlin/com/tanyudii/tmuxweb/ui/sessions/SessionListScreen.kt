package com.tanyudii.tmuxweb.ui.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
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
import com.tanyudii.tmuxweb.ui.components.TmuxErrorBanner
import com.tanyudii.tmuxweb.ui.components.TmuxGroup
import com.tanyudii.tmuxweb.ui.components.TmuxGroupDivider
import com.tanyudii.tmuxweb.ui.components.TmuxIconButton
import com.tanyudii.tmuxweb.ui.components.TmuxIconButtonSize
import com.tanyudii.tmuxweb.ui.components.TmuxListRow
import com.tanyudii.tmuxweb.ui.components.TmuxNavBar
import com.tanyudii.tmuxweb.ui.components.TmuxProgressBar
import com.tanyudii.tmuxweb.ui.components.TmuxStatusBadge
import com.tanyudii.tmuxweb.ui.components.TmuxStatusTone
import com.tanyudii.tmuxweb.ui.components.TmuxSwipeToDeleteRow
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxMonoSize
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
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
    val deleteProjectState = rememberDeleteProjectState(projectId, onDeleted = onBack)

    SessionListScreen(
        projectName = projectName,
        projectRepoPath = projectRepoPath,
        state = state,
        viewModel = viewModel,
        deleteProjectState = deleteProjectState,
        onOpenSession = onOpenSession,
        onNewSessionClick = { isCreateSheetOpen = true },
        onBack = onBack,
    )

    if (isCreateSheetOpen || state.sessionCreation != null) {
        NewSessionSheet(
            creationState = state.sessionCreation,
            onCreate = { name -> isCreateSheetOpen = false; viewModel.createSession(name) },
            onCancel = { isCreateSheetOpen = false; viewModel.cancelSessionCreation() },
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
    onBack: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize().background(TmuxColors.bgSurface)) {
        TmuxNavBar(
            title = projectName,
            onBack = onBack,
            backLabel = "Projects",
            right = {
                TmuxIconButton(
                    icon = TmuxIcons.Plus,
                    contentDescription = "New session",
                    size = TmuxIconButtonSize.LG,
                    onClick = onNewSessionClick,
                )
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
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.verticalScroll(rememberScrollState()).padding(top = 8.dp)) {
        state.sessionCreation?.let { creation -> CreatingSessionCard(creation.progressMessage) }
        when {
            state.sessions.isEmpty() && state.sessionCreation == null -> EmptySessionsState()
            else -> SessionsGroup(state.sessions, viewModel, onOpenSession)
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

@Composable
private fun SessionsGroup(
    sessions: List<ProjectSession>,
    viewModel: SessionListViewModel,
    onOpenSession: (ProjectSession) -> Unit,
) {
    TmuxGroup {
        sessions.forEachIndexed { index, session ->
            if (index > 0) TmuxGroupDivider()
            // Keyed by identity, not loop position: without this, deleting a
            // row shifts every row below it up by one slot, and
            // TmuxSwipeToDeleteRow's remembered `hasFired`/dismiss-animation
            // state (bound to the slot) leaks onto the session that now
            // occupies it -- its next swipe is silently vetoed.
            key(session.fullName) {
                TmuxSwipeToDeleteRow(onDelete = { viewModel.delete(session) }) {
                    TmuxListRow(
                        title = session.name,
                        icon = TmuxIcons.Terminal,
                        subtitle = sessionSubtitle(session),
                        trailing = {
                            TmuxStatusBadge(
                                text = if (session.attached) "attached" else "detached",
                                tone = if (session.attached) TmuxStatusTone.ATTACHED else TmuxStatusTone.IDLE,
                                dot = session.attached,
                            )
                        },
                        onClick = { onOpenSession(session) },
                    )
                }
            }
        }
    }
}

@Composable
private fun CreatingSessionCard(progressMessage: String?) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .background(TmuxColors.bgCard, RoundedCornerShape(TmuxRadius.xl))
            .padding(14.dp),
    ) {
        TmuxProgressBar(label = progressMessage ?: "Creating session…")
    }
}

@Composable
private fun EmptySessionsState() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxWidth().padding(top = 48.dp, start = 30.dp, end = 30.dp),
    ) {
        Icon(
            TmuxIcons.Terminal,
            contentDescription = null,
            tint = TmuxColors.textTertiary,
            modifier = Modifier.padding(bottom = 10.dp),
        )
        Text(
            "No active sessions",
            color = TmuxColors.textPrimary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.base,
        )
        Text(
            "Tap + to start one.",
            color = TmuxColors.textTertiary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.sm,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

private fun sessionSubtitle(session: ProjectSession): String =
    "${session.windows} window${if (session.windows == 1) "" else "s"}"

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
