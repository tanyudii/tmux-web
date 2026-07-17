package com.tanyudii.tmuxweb.ui.web

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
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
import com.tanyudii.tmuxweb.domain.model.AccessLogEntry
import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.EnvStatus
import com.tanyudii.tmuxweb.domain.model.GroupedChanges
import com.tanyudii.tmuxweb.domain.model.SessionResourceUsage
import com.tanyudii.tmuxweb.domain.model.SessionTemplate
import com.tanyudii.tmuxweb.domain.repository.AccessLogRepository
import com.tanyudii.tmuxweb.domain.repository.ChangesRepository
import com.tanyudii.tmuxweb.domain.repository.EnvironmentRepository
import com.tanyudii.tmuxweb.domain.repository.ProjectsRepository
import com.tanyudii.tmuxweb.domain.repository.SessionResourceUsageRepository
import com.tanyudii.tmuxweb.domain.repository.SessionTemplatesRepository
import com.tanyudii.tmuxweb.domain.repository.SessionsRepository
import com.tanyudii.tmuxweb.presentation.AccessLogViewModel
import com.tanyudii.tmuxweb.presentation.ChangesViewModel
import com.tanyudii.tmuxweb.presentation.EnvironmentViewModel
import com.tanyudii.tmuxweb.presentation.PendingDiscard
import com.tanyudii.tmuxweb.presentation.SessionResourceUsageViewModel
import com.tanyudii.tmuxweb.presentation.WebShellUiState
import com.tanyudii.tmuxweb.presentation.WebShellViewModel
import com.tanyudii.tmuxweb.ui.components.CommandPaletteItem
import com.tanyudii.tmuxweb.ui.components.TmuxButton
import com.tanyudii.tmuxweb.ui.components.TmuxButtonSize
import com.tanyudii.tmuxweb.ui.components.TmuxButtonVariant
import com.tanyudii.tmuxweb.ui.components.TmuxCommandPalette
import com.tanyudii.tmuxweb.ui.components.TmuxConfirmDialog
import com.tanyudii.tmuxweb.ui.components.TmuxErrorBanner
import com.tanyudii.tmuxweb.ui.components.TmuxProgressBar
import com.tanyudii.tmuxweb.ui.components.TmuxTextField
import com.tanyudii.tmuxweb.ui.components.buildCommandPaletteItems
import com.tanyudii.tmuxweb.ui.components.commandPaletteShortcut
import com.tanyudii.tmuxweb.ui.terminal.rememberTerminalSession
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
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
    val templatesRepository: SessionTemplatesRepository = koinInject()
    val sessionHolder: TmuxWebSessionHolder = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember { WebShellViewModel(projectsRepository, sessionsRepository, templatesRepository, scope) }
    val state by viewModel.state.collectAsState()
    val serverHost = remember(sessionHolder) { sessionHolder.require().baseUrl.substringAfter("://").trimEnd('/') }

    var activeWindow by remember(state.selectedSessionName) { mutableStateOf(0) }
    var railOpen by remember { mutableStateOf(true) }

    val selectedSession = state.selectedSession
    val terminal = selectedSession?.let { rememberTerminalSession(it.fullName) }
    val changesState = selectedProjectAndSession(state)?.let { (pid, name) -> rememberChangesState(pid, name) }
    val environmentState = selectedProjectAndSession(state)?.let { (pid, name) -> rememberEnvironmentState(pid, name) }
    val resourceUsage = selectedProjectAndSession(state)?.let { (pid, name) -> rememberResourceUsage(pid, name) }

    // EMB-218: see Modifier.commandPaletteShortcut's doc comment for why a
    // Compose-level key listener is naturally immune to colliding with
    // terminal shortcuts, with no activeElement check needed.
    var paletteOpen by remember { mutableStateOf(false) }
    var accessLogOpen by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxSize().background(TmuxColors.bgApp)
            .commandPaletteShortcut(
                onOpen = {
                    paletteOpen = true
                    viewModel.loadAllSessions()
                },
            ),
    ) {
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
                onOpenAccessLog = { accessLogOpen = true },
            )
            WebMainPane(
                project = state.selectedProject,
                session = selectedSession,
                terminal = terminal,
                changes = changesState?.changes,
                environment = environmentState?.status,
                environmentBusy = environmentState?.isBusy ?: false,
                logsService = environmentState?.logsService,
                resourceUsage = resourceUsage,
                railOpen = railOpen,
                activeWindow = activeWindow,
                onSelectWindow = { activeWindow = it },
                onWindowsChanged = { state.selectedProjectId?.let(viewModel::refreshSessions) },
                onToggleRail = { railOpen = !railOpen },
                onNewSession = { state.selectedProjectId?.let(viewModel::showNewSessionDialog) },
                onEnvironmentRun = { environmentState?.viewModel?.setup() },
                onEnvironmentStop = { environmentState?.viewModel?.stop() },
                onEnvironmentCancel = { environmentState?.viewModel?.cancel() },
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

    if (paletteOpen) {
        TmuxCommandPalette(
            items = buildCommandPaletteItems(state.projects, state.sessionsByProjectId),
            onSelect = { item ->
                when (item) {
                    is CommandPaletteItem.ProjectEntry -> viewModel.selectProject(item.projectId)
                    is CommandPaletteItem.SessionEntry -> viewModel.selectSession(item.projectId, item.sessionName)
                }
                paletteOpen = false
            },
            onDismiss = { paletteOpen = false },
        )
    }

    if (accessLogOpen) {
        AccessLogDialog(onDismiss = { accessLogOpen = false })
    }
}

@Composable
private fun AccessLogDialog(onDismiss: () -> Unit) {
    val repository: AccessLogRepository = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember { AccessLogViewModel(repository, scope) }
    val state by viewModel.state.collectAsState()

    CenterDialog(
        title = "Access log",
        onCancel = onDismiss,
        footer = {
            TmuxButton(onClick = viewModel::refresh, text = "Refresh", variant = TmuxButtonVariant.GHOST)
            TmuxButton(onClick = onDismiss, text = "Close", variant = TmuxButtonVariant.PRIMARY)
        },
    ) {
        Text(
            "Requests authenticated with this server's shared token -- identifies activity per IP, not per person.",
            color = TmuxColors.textTertiary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.xs,
        )
        when {
            state.isLoading -> TmuxProgressBar(label = "Loading…")
            state.errorMessage != null -> ErrorText(state.errorMessage!!)
            state.entries.isEmpty() -> Text(
                "No access recorded yet.",
                color = TmuxColors.textTertiary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.sm,
            )
            else -> LazyColumn(modifier = Modifier.heightIn(max = 320.dp)) {
                items(state.entries, key = { "${it.timestamp}-${it.path}-${it.outcome}" }) { entry ->
                    AccessLogRow(entry)
                }
            }
        }
    }
}

@Composable
private fun AccessLogRow(entry: AccessLogEntry) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                entry.timestamp,
                color = TmuxColors.textSecondary,
                fontFamily = TmuxFonts.mono,
                fontSize = TmuxTextSize.xs,
            )
            Text(
                entry.outcome,
                color = if (entry.outcome == "authorized") TmuxColors.accent else TmuxColors.red500,
                fontFamily = TmuxFonts.mono,
                fontSize = TmuxTextSize.xs,
                fontWeight = TmuxWeight.semibold,
            )
        }
        Text(
            "${entry.method} ${entry.path} · ${entry.ip}",
            color = TmuxColors.textPrimary,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxTextSize.sm,
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
            templates = dialogState.templates,
            onCreate = viewModel::createSession,
            onSaveAsTemplate = viewModel::saveAsTemplate,
            onDeleteTemplate = viewModel::deleteTemplate,
            onCancel = viewModel::cancelNewSessionDialog,
        )
    }
    state.pendingDelete?.let { pending ->
        val (title, message) = pendingDeleteCopy(pending)
        val isUnmergedSessionDelete = pending is WebShellUiState.PendingDelete.OfSession &&
            pending.deleteBranch && pending.branchMergeChecked && pending.branchMerged == false
        TmuxConfirmDialog(
            title = title,
            message = message,
            force = pending.forced,
            confirmLabel = if (isUnmergedSessionDelete) "Delete anyway" else "Delete",
            onConfirm = viewModel::confirmPendingDelete,
            onCancel = viewModel::cancelPendingDelete,
            content = (pending as? WebShellUiState.PendingDelete.OfSession)?.let { session ->
                { DeleteBranchOption(session, onToggle = viewModel::setDeleteBranchOnSessionDelete) }
            },
        )
    }
}

/**
 * EMB-207: "Delete branch too" checkbox + inline unmerged-branch warning,
 * shown inside [TmuxConfirmDialog]'s content slot.
 */
@Composable
private fun ColumnScope.DeleteBranchOption(
    pending: WebShellUiState.PendingDelete.OfSession,
    onToggle: (Boolean) -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(top = 12.dp).clickable { onToggle(!pending.deleteBranch) },
    ) {
        Checkbox(checked = pending.deleteBranch, onCheckedChange = onToggle)
        Text(
            "Delete branch too",
            color = TmuxColors.textSecondary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.sm,
        )
    }
    if (pending.deleteBranch && pending.branchMergeChecked && pending.branchMerged == false) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                .background(TmuxColors.amberGlow, RoundedCornerShape(TmuxRadius.sm))
                .padding(horizontal = 10.dp, vertical = 8.dp),
        ) {
            Icon(
                TmuxIcons.Alert,
                contentDescription = null,
                tint = TmuxColors.amber500,
                modifier = Modifier.size(14.dp),
            )
            Text(
                "This branch isn't merged -- deleting it discards its commits permanently.",
                color = TmuxColors.amber500,
                fontFamily = TmuxFonts.mono,
                fontSize = TmuxTextSize.xs,
                modifier = Modifier.padding(start = 8.dp),
            )
        }
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

/** EMB-214: polls the selected session's CPU/mem every 5s -- see SessionResourceUsageViewModel. */
@Composable
private fun rememberResourceUsage(projectId: String, sessionName: String): SessionResourceUsage? {
    val repository: SessionResourceUsageRepository = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember(projectId, sessionName) {
        SessionResourceUsageViewModel(projectId, sessionName, repository, scope)
    }
    val usage by viewModel.state.collectAsState()
    return usage
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
    templates: List<SessionTemplate>,
    onCreate: (name: String, startupCommand: String?) -> Unit,
    onSaveAsTemplate: (name: String, startupCommand: String?) -> Unit,
    onDeleteTemplate: (templateId: String) -> Unit,
    onCancel: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var startupCommand by remember { mutableStateOf("") }
    CenterDialog(
        title = "New session · $projectName",
        onCancel = { if (!isSaving) onCancel() },
        footer = {
            TmuxButton(onClick = onCancel, text = "Cancel", variant = TmuxButtonVariant.GHOST, enabled = !isSaving)
            TmuxButton(
                onClick = { onCreate(name, startupCommand.takeIf { it.isNotBlank() }) },
                text = "Create session",
                variant = TmuxButtonVariant.PRIMARY,
                loading = isSaving,
            )
        },
    ) {
        if (templates.isNotEmpty()) {
            TemplatePicker(
                templates = templates,
                enabled = !isSaving,
                onApply = { template ->
                    name = template.name
                    startupCommand = template.startupCommand.orEmpty()
                },
                onDelete = onDeleteTemplate,
            )
        }
        TmuxTextField(
            value = name,
            onValueChange = { name = it },
            label = "Session name",
            placeholder = "build",
            mono = true,
            enabled = !isSaving,
        )
        TmuxTextField(
            value = startupCommand,
            onValueChange = { startupCommand = it },
            label = "Startup command (optional)",
            placeholder = "npm run dev",
            mono = true,
            enabled = !isSaving,
        )
        TmuxButton(
            onClick = { onSaveAsTemplate(name, startupCommand.takeIf { it.isNotBlank() }) },
            text = "Save as template",
            variant = TmuxButtonVariant.SECONDARY,
            size = TmuxButtonSize.SM,
            enabled = !isSaving && name.isNotBlank(),
        )
        if (isSaving) {
            TmuxProgressBar(label = progressMessage ?: "Creating session… polling backend")
        }
        errorMessage?.let { ErrorText(it) }
    }
}

/** EMB-220: saved per-project session templates, offered as one-click fill-ins for name + startup command. */
@Composable
private fun TemplatePicker(
    templates: List<SessionTemplate>,
    enabled: Boolean,
    onApply: (SessionTemplate) -> Unit,
    onDelete: (templateId: String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Templates", color = TmuxColors.textTertiary, fontFamily = TmuxFonts.sans, fontSize = TmuxTextSize.xs)
        Column(
            modifier = Modifier.heightIn(max = 140.dp)
                .background(TmuxColors.bgApp, RoundedCornerShape(TmuxRadius.md)),
        ) {
            templates.forEach { template ->
                TemplateRow(
                    template = template,
                    enabled = enabled,
                    onApply = { onApply(template) },
                    onDelete = { onDelete(template.id) },
                )
            }
        }
    }
}

@Composable
private fun TemplateRow(template: SessionTemplate, enabled: Boolean, onApply: () -> Unit, onDelete: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth()
            .clickable(enabled = enabled, onClick = onApply)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(template.name, color = TmuxColors.textPrimary, fontFamily = TmuxFonts.mono, fontSize = TmuxTextSize.sm)
            template.startupCommand?.let {
                Text(it, color = TmuxColors.textTertiary, fontFamily = TmuxFonts.mono, fontSize = TmuxTextSize.xs)
            }
        }
        Icon(
            TmuxIcons.Trash,
            contentDescription = "Delete template",
            tint = TmuxColors.textTertiary,
            modifier = Modifier.clickable(enabled = enabled, onClick = onDelete),
        )
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
