package com.tanyudii.tmuxweb.ui.web

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.tanyudii.tmuxweb.di.TmuxWebSessionHolder
import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.EnvStatus
import com.tanyudii.tmuxweb.domain.model.GroupedChanges
import com.tanyudii.tmuxweb.domain.repository.ChangesRepository
import com.tanyudii.tmuxweb.domain.repository.EnvironmentRepository
import com.tanyudii.tmuxweb.domain.repository.ProjectsRepository
import com.tanyudii.tmuxweb.domain.repository.SessionsRepository
import com.tanyudii.tmuxweb.presentation.ChangesViewModel
import com.tanyudii.tmuxweb.presentation.EnvironmentViewModel
import com.tanyudii.tmuxweb.presentation.PendingDiscard
import com.tanyudii.tmuxweb.presentation.WebShellUiState
import com.tanyudii.tmuxweb.presentation.WebShellViewModel
import com.tanyudii.tmuxweb.ui.components.TmuxButton
import com.tanyudii.tmuxweb.ui.components.TmuxButtonVariant
import com.tanyudii.tmuxweb.ui.components.TmuxConfirmDialog
import com.tanyudii.tmuxweb.ui.components.TmuxErrorBanner
import com.tanyudii.tmuxweb.ui.components.TmuxProgressBar
import com.tanyudii.tmuxweb.ui.components.TmuxTextField
import com.tanyudii.tmuxweb.ui.terminal.rememberTerminalSession
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight
import org.koin.compose.koinInject

/**
 * Root of the Web-first, wide-viewport experience — sidebar project/session
 * tree, master-detail terminal, git-changes rail. Mounted from `App.kt`'s
 * private `AdaptiveRoot` composable when the available width crosses the
 * desktop breakpoint (900.dp, see `App.kt`); ports `ui_kits/web/app.jsx`
 * from the design-system handoff.
 */
@Composable
fun WebShellScreen(onSwitchServer: () -> Unit) {
    val projectsRepository: ProjectsRepository = koinInject()
    val sessionsRepository: SessionsRepository = koinInject()
    val sessionHolder: TmuxWebSessionHolder = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember { WebShellViewModel(projectsRepository, sessionsRepository, scope) }
    val state by viewModel.state.collectAsState()
    val serverHost = remember(sessionHolder) { sessionHolder.require().baseUrl.substringAfter("://").trimEnd('/') }

    var activeWindow by remember(state.selectedSessionName) { mutableStateOf(0) }
    var railOpen by remember { mutableStateOf(true) }

    val selectedSession = state.selectedSession
    val terminal = selectedSession?.let { rememberTerminalSession(it.fullName) }
    val changesState = selectedProjectAndSession(state)?.let { (pid, name) -> rememberChangesState(pid, name) }
    val environmentState = selectedProjectAndSession(state)?.let { (pid, name) -> rememberEnvironmentState(pid, name) }

    Column(modifier = Modifier.fillMaxSize().background(TmuxColors.bgApp)) {
        state.errorMessage?.let { message ->
            TmuxErrorBanner(message = message, onDismiss = viewModel::dismissError)
        }
        Row(modifier = Modifier.weight(1f).fillMaxWidth()) {
            WebSidebar(
                state = state,
                serverHost = serverHost,
                isConnected = terminal?.isConnected ?: true,
                onToggleCollapsed = viewModel::toggleSidebarCollapsed,
                onToggleProject = viewModel::toggleProject,
                onSelectProject = viewModel::selectProject,
                onSelectSession = viewModel::selectSession,
                onNewProject = viewModel::showNewProjectDialog,
                onNewSession = viewModel::showNewSessionDialog,
                onDeleteProject = viewModel::requestDeleteProject,
                onDeleteSession = viewModel::requestDeleteSession,
                onOpenSettings = onSwitchServer,
            )
            WebMainPane(
                project = state.selectedProject,
                session = selectedSession,
                terminal = terminal,
                changes = changesState?.changes,
                environment = environmentState?.status,
                environmentBusy = environmentState?.isBusy ?: false,
                logsService = environmentState?.logsService,
                railOpen = railOpen,
                activeWindow = activeWindow,
                onSelectWindow = { activeWindow = it },
                onWindowsChanged = { state.selectedProjectId?.let(viewModel::refreshSessions) },
                onToggleRail = { railOpen = !railOpen },
                onNewSession = { state.selectedProjectId?.let(viewModel::showNewSessionDialog) },
                onEnvironmentRun = { environmentState?.viewModel?.setup() },
                onEnvironmentStop = { environmentState?.viewModel?.stop() },
                onViewLogs = { service -> environmentState?.viewModel?.showLogs(service) },
                onSwitchLogsService = { service -> environmentState?.viewModel?.switchLogsService(service) },
                onHideLogs = { environmentState?.viewModel?.hideLogs() },
                onStageFile = { file -> changesState?.viewModel?.stage(file) },
                onUnstageFile = { file -> changesState?.viewModel?.unstage(file) },
                onDiscardFile = { file, mode -> changesState?.viewModel?.requestDiscard(file, mode) },
                hasPendingDiscard = changesState?.pendingDiscard != null,
                commitMessage = changesState?.commitMessage.orEmpty(),
                onCommitMessageChange = { message -> changesState?.viewModel?.updateCommitMessage(message) },
                isCommitting = changesState?.isCommitting ?: false,
                onCommit = { changesState?.viewModel?.commit() },
                modifier = Modifier.weight(1f),
                isTerminalVisible = !state.hasOpenDialog,
            )
        }
    }

    WebShellDialogs(state = state, viewModel = viewModel)

    changesState?.pendingDiscard?.let { pending ->
        TmuxConfirmDialog(
            title = "Discard changes?",
            message = discardConfirmMessage(pending),
            confirmLabel = "Discard",
            onConfirm = { changesState.viewModel.confirmDiscard() },
            onCancel = { changesState.viewModel.cancelDiscard() },
        )
    }
}

private fun discardConfirmMessage(pending: PendingDiscard): String {
    val fileName = pending.file.path.substringAfterLast('/')
    return if (pending.mode == DiffMode.UNTRACKED) {
        "“$fileName” will be deleted. This can't be undone."
    } else {
        "Uncommitted changes to “$fileName” will be reverted. This can't be undone."
    }
}

/**
 * Surfaces [WebShellUiState.errorMessage] — previously set by the ViewModel
 * on load/poll failures but never rendered anywhere, so failures (e.g. an
 * unreachable backend) left the sidebar silently empty with no explanation.
 * Found during manual browser verification of this screen.
 */
/**
 * Hosts the three modal dialogs this screen can show (new project, new
 * session, pending delete). Split out of [WebShellScreen] purely to keep
 * that composable's line count under the project's threshold — no behavior
 * change.
 */
@Composable
private fun WebShellDialogs(state: WebShellUiState, viewModel: WebShellViewModel) {
    state.newProjectDialog?.let { dialogState ->
        NewProjectDialog(
            isSaving = dialogState.isSaving,
            errorMessage = dialogState.errorMessage,
            onCreate = viewModel::createProject,
            onCancel = viewModel::cancelNewProjectDialog,
        )
    }
    state.newSessionDialog?.let { dialogState ->
        val projectName = state.projects.find { it.id == dialogState.projectId }?.name.orEmpty()
        NewSessionDialog(
            projectName = projectName,
            isSaving = dialogState.isSaving,
            progressMessage = dialogState.progressMessage,
            errorMessage = dialogState.errorMessage,
            onCreate = viewModel::createSession,
            onCancel = viewModel::cancelNewSessionDialog,
        )
    }
    state.pendingDelete?.let { pending ->
        val (title, message) = pendingDeleteCopy(pending)
        TmuxConfirmDialog(
            title = title,
            message = message,
            force = pending.forced,
            onConfirm = viewModel::confirmPendingDelete,
            onCancel = viewModel::cancelPendingDelete,
        )
    }
}

private fun selectedProjectAndSession(state: WebShellUiState): Pair<String, String>? {
    val projectId = state.selectedProjectId ?: return null
    val sessionName = state.selectedSession?.name ?: return null
    return projectId to sessionName
}

private fun pendingDeleteCopy(pending: WebShellUiState.PendingDelete): Pair<String, String> = when (pending) {
    is WebShellUiState.PendingDelete.OfProject ->
        "Delete project?" to (pending.message ?: "“${pending.project.name}” will be removed from the server.")
    is WebShellUiState.PendingDelete.OfSession ->
        "Delete session?" to (pending.message ?: "“${pending.session.name}” will be closed.")
}

private class ChangesState(
    val viewModel: ChangesViewModel,
    val changes: GroupedChanges?,
    val pendingDiscard: PendingDiscard?,
    val commitMessage: String,
    val isCommitting: Boolean,
)

@Composable
private fun rememberChangesState(projectId: String, sessionName: String): ChangesState {
    val repository: ChangesRepository = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember(projectId, sessionName) { ChangesViewModel(projectId, sessionName, repository, scope) }
    val state by viewModel.state.collectAsState()
    return remember(viewModel, state.changes, state.pendingDiscard, state.commitMessage, state.isCommitting) {
        ChangesState(viewModel, state.changes, state.pendingDiscard, state.commitMessage, state.isCommitting)
    }
}

private class EnvironmentState(
    val viewModel: EnvironmentViewModel,
    val status: EnvStatus?,
    val isBusy: Boolean,
    val logsService: String?,
)

@Composable
private fun rememberEnvironmentState(projectId: String, sessionName: String): EnvironmentState {
    val repository: EnvironmentRepository = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember(projectId, sessionName) { EnvironmentViewModel(projectId, sessionName, repository, scope) }
    val state by viewModel.state.collectAsState()
    return remember(viewModel, state.status, state.isBusy, state.logsService) {
        EnvironmentState(viewModel, state.status, state.isBusy, state.logsService)
    }
}

@Composable
private fun NewProjectDialog(
    isSaving: Boolean,
    errorMessage: String?,
    onCreate: (name: String, repoPath: String) -> Unit,
    onCancel: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var repoPath by remember { mutableStateOf("") }
    var pickerOpen by remember { mutableStateOf(false) }

    CenterDialog(
        title = "New project",
        onCancel = onCancel,
        footer = {
            TmuxButton(onClick = onCancel, text = "Cancel", variant = TmuxButtonVariant.GHOST, enabled = !isSaving)
            TmuxButton(
                onClick = { onCreate(name, repoPath) },
                text = "Create project",
                variant = TmuxButtonVariant.PRIMARY,
                loading = isSaving,
                enabled = name.isNotBlank() && repoPath.isNotBlank(),
            )
        },
    ) {
        TmuxTextField(value = name, onValueChange = { name = it }, label = "Name", placeholder = "api-gateway")
        RepoPathField(repoPath = repoPath, onClick = { pickerOpen = true })
        errorMessage?.let { ErrorText(it) }
    }

    if (pickerOpen) {
        RepoPathPicker(
            onPicked = { path ->
                repoPath = path
                pickerOpen = false
            },
            onCancel = { pickerOpen = false },
        )
    }
}

@Composable
private fun NewSessionDialog(
    projectName: String,
    isSaving: Boolean,
    progressMessage: String?,
    errorMessage: String?,
    onCreate: (String) -> Unit,
    onCancel: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    CenterDialog(
        title = "New session · $projectName",
        onCancel = { if (!isSaving) onCancel() },
        footer = {
            TmuxButton(onClick = onCancel, text = "Cancel", variant = TmuxButtonVariant.GHOST, enabled = !isSaving)
            TmuxButton(
                onClick = { onCreate(name) },
                text = "Create session",
                variant = TmuxButtonVariant.PRIMARY,
                loading = isSaving,
            )
        },
    ) {
        TmuxTextField(
            value = name,
            onValueChange = { name = it },
            label = "Session name",
            placeholder = "build",
            mono = true,
            enabled = !isSaving,
        )
        if (isSaving) {
            TmuxProgressBar(label = progressMessage ?: "Creating session… polling backend")
        }
        errorMessage?.let { ErrorText(it) }
    }
}

@Composable
private fun ErrorText(message: String) {
    Text(message, color = TmuxColors.red500, fontFamily = TmuxFonts.sans, fontSize = TmuxTextSize.sm)
}

@Composable
private fun CenterDialog(
    title: String,
    onCancel: () -> Unit,
    footer: @Composable RowScope.() -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismissRequest = onCancel) {
        Column(modifier = Modifier.width(420.dp).background(TmuxColors.bgCard, RoundedCornerShape(TmuxRadius.lg))) {
            Text(
                title,
                color = TmuxColors.textPrimary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.md,
                fontWeight = TmuxWeight.semibold,
                modifier = Modifier.padding(20.dp),
            )
            Column(
                modifier = Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                content = content,
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(20.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End),
                content = footer,
            )
        }
    }
}
