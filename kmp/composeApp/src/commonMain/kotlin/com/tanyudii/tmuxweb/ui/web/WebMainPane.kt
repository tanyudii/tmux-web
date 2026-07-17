package com.tanyudii.tmuxweb.ui.web

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.data.remote.logs.LogsSocket
import com.tanyudii.tmuxweb.domain.model.ChangedFile
import com.tanyudii.tmuxweb.domain.model.ComposeServiceStatus
import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.EnvStatus
import com.tanyudii.tmuxweb.domain.model.GroupedChanges
import com.tanyudii.tmuxweb.domain.model.Project
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.domain.repository.ChangesRepository
import com.tanyudii.tmuxweb.presentation.DiffViewModel
import com.tanyudii.tmuxweb.presentation.LogsViewModel
import com.tanyudii.tmuxweb.terminal.PlatformTerminalView
import com.tanyudii.tmuxweb.terminal.observeAppForeground
import com.tanyudii.tmuxweb.ui.components.TmuxButton
import com.tanyudii.tmuxweb.ui.components.TmuxButtonVariant
import com.tanyudii.tmuxweb.ui.components.TmuxConnectionBanner
import com.tanyudii.tmuxweb.ui.components.TmuxConnectionStatus
import com.tanyudii.tmuxweb.ui.components.TmuxDiffDialog
import com.tanyudii.tmuxweb.ui.components.TmuxEnvironmentMenu
import com.tanyudii.tmuxweb.ui.components.TmuxIconButton
import com.tanyudii.tmuxweb.ui.components.TmuxIconButtonVariant
import com.tanyudii.tmuxweb.ui.components.TmuxLogsDialog
import com.tanyudii.tmuxweb.ui.components.TmuxStatusBadge
import com.tanyudii.tmuxweb.ui.components.TmuxStatusTone
import com.tanyudii.tmuxweb.ui.terminal.TerminalSession
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight
import org.koin.compose.koinInject

/**
 * Master-detail main area: breadcrumb top bar, tmux window tabs, terminal
 * viewport, and the git-changes rail — ports the `<main>` in
 * `ui_kits/web/app.jsx`. Window "tabs" here send the real tmux prefix
 * (Ctrl+B) + digit key sequence into the PTY rather than calling a
 * per-window REST endpoint: the backend contract (plan §2.2) has no such
 * endpoint — window switching is a tmux keybinding, not an API call — so
 * `activeWindow` below is a local optimistic highlight only, not a value
 * the backend confirms.
 */
@Composable
fun WebMainPane(
    project: Project?,
    session: ProjectSession?,
    terminal: TerminalSession?,
    changes: GroupedChanges?,
    environment: EnvStatus?,
    environmentBusy: Boolean,
    logsService: String?,
    railOpen: Boolean,
    activeWindow: Int,
    onSelectWindow: (Int) -> Unit,
    onWindowsChanged: () -> Unit,
    onToggleRail: () -> Unit,
    onNewSession: () -> Unit,
    onEnvironmentRun: () -> Unit,
    onEnvironmentStop: () -> Unit,
    onViewLogs: (String) -> Unit,
    onSwitchLogsService: (String) -> Unit,
    onHideLogs: () -> Unit,
    onStageFile: (ChangedFile) -> Unit = {},
    onUnstageFile: (ChangedFile) -> Unit = {},
    onDiscardFile: (ChangedFile, DiffMode) -> Unit = { _, _ -> },
    hasPendingDiscard: Boolean = false,
    commitMessage: String = "",
    onCommitMessageChange: (String) -> Unit = {},
    isCommitting: Boolean = false,
    onCommit: () -> Unit = {},
    modifier: Modifier = Modifier,
    isTerminalVisible: Boolean = true,
) {
    // Any Popup opened from within this pane (environment dropdown, window
    // rename/close confirm) needs to hide the terminal's native DOM element
    // for its duration -- see PlatformTerminalView's `isVisible` kdoc. Each
    // child reports its own open state here rather than owning a shared
    // dialog-stack, since at most one of these is ever open at a time.
    var environmentMenuOpen by remember { mutableStateOf(false) }
    var windowDialogOpen by remember { mutableStateOf(false) }
    var diffTarget by remember(session?.name) { mutableStateOf<DiffTarget?>(null) }

    Column(modifier = modifier.fillMaxSize().background(TmuxColors.bgApp)) {
        if (session == null || terminal == null) {
            EmptyMainPane(project = project, onNewSession = onNewSession)
            return@Column
        }

        // ChangesRail is a full-height sibling of this column -- not stacked
        // below WindowTabs -- so it starts flush at the very top (aligned
        // with TopBar) instead of hanging below a tab row that's mostly
        // empty once only a couple of tmux windows are open.
        Row(modifier = Modifier.weight(1f).fillMaxWidth()) {
            MainContent(
                project = project,
                session = session,
                terminal = terminal,
                environment = environment,
                environmentBusy = environmentBusy,
                railOpen = railOpen,
                activeWindow = activeWindow,
                onSelectWindow = onSelectWindow,
                onWindowsChanged = onWindowsChanged,
                onToggleRail = onToggleRail,
                onEnvironmentRun = onEnvironmentRun,
                onEnvironmentStop = onEnvironmentStop,
                onViewLogs = onViewLogs,
                terminalVisible = isTerminalVisible && !environmentMenuOpen && !windowDialogOpen &&
                    diffTarget == null && logsService == null && !hasPendingDiscard,
                onEnvironmentMenuOpenChanged = { environmentMenuOpen = it },
                onDialogOpenChanged = { windowDialogOpen = it },
                modifier = Modifier.weight(1f).fillMaxHeight(),
            )
            if (railOpen) {
                ChangesRail(
                    changes = changes,
                    onFileClick = { file, mode -> diffTarget = DiffTarget(file, mode) },
                    onStage = onStageFile,
                    onUnstage = onUnstageFile,
                    onDiscard = onDiscardFile,
                    commitMessage = commitMessage,
                    onCommitMessageChange = onCommitMessageChange,
                    isCommitting = isCommitting,
                    onCommit = onCommit,
                )
            }
        }

        MainPaneDiffDialog(
            projectId = project?.id,
            sessionName = session.name,
            diffTarget = diffTarget,
            onDismiss = { diffTarget = null },
        )

        MainPaneLogsDialog(
            projectId = project?.id,
            sessionName = session.name,
            service = logsService,
            services = environment?.services.orEmpty(),
            onDismiss = onHideLogs,
            onSwitchService = onSwitchLogsService,
        )
    }
}

private data class DiffTarget(val file: ChangedFile, val mode: DiffMode)

/**
 * Top bar, tmux window tabs, terminal viewport, and status footer -- the
 * left side of [WebMainPane]'s main Row, sized independently of
 * [ChangesRail]. Split out purely to keep [WebMainPane] under the project's
 * detekt line-count threshold -- no behavior change.
 */
@Composable
private fun MainContent(
    project: Project?,
    session: ProjectSession,
    terminal: TerminalSession,
    environment: EnvStatus?,
    environmentBusy: Boolean,
    railOpen: Boolean,
    activeWindow: Int,
    onSelectWindow: (Int) -> Unit,
    onWindowsChanged: () -> Unit,
    onToggleRail: () -> Unit,
    onEnvironmentRun: () -> Unit,
    onEnvironmentStop: () -> Unit,
    onViewLogs: (String) -> Unit,
    terminalVisible: Boolean,
    onEnvironmentMenuOpenChanged: (Boolean) -> Unit,
    onDialogOpenChanged: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        TopBar(
            project = project,
            session = session,
            environment = environment,
            environmentBusy = environmentBusy,
            railOpen = railOpen,
            onToggleRail = onToggleRail,
            onEnvironmentRun = onEnvironmentRun,
            onEnvironmentStop = onEnvironmentStop,
            onViewLogs = onViewLogs,
            onEnvironmentMenuOpenChanged = onEnvironmentMenuOpenChanged,
        )
        WindowTabs(
            windowCount = session.windows,
            activeWindow = activeWindow,
            serverWindowNames = session.windowNames,
            onSelectWindow = onSelectWindow,
            onWindowsChanged = onWindowsChanged,
            terminal = terminal,
            onDialogOpenChanged = onDialogOpenChanged,
        )

        if (!terminal.isConnected) {
            TmuxConnectionBanner(
                status = TmuxConnectionStatus.RECONNECTING,
                message = "Reconnecting to the server…",
                onRetry = terminal::onRetry,
            )
        }

        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            // Keyed by session identity -- without this, switching sessions
            // directly (no intermediate null selection) reuses the xterm.js
            // instance instead of recreating it.
            key(session.fullName) {
                PlatformTerminalView(
                    modifier = Modifier.fillMaxSize(),
                    onInput = terminal::onInput,
                    onBell = terminal::onBell,
                    onResize = terminal::onResize,
                    handleReady = terminal.onHandleReady,
                    isVisible = terminalVisible,
                )
            }
        }

        StatusFooter(session = session)
    }
}

/** Hosts [DiffDialogHost] once a [DiffTarget] is picked -- split out purely to keep [WebMainPane] short. */
@Composable
private fun MainPaneDiffDialog(
    projectId: String?,
    sessionName: String,
    diffTarget: DiffTarget?,
    onDismiss: () -> Unit,
) {
    if (projectId == null || diffTarget == null) return
    DiffDialogHost(projectId = projectId, sessionName = sessionName, target = diffTarget, onDismiss = onDismiss)
}

/**
 * Owns the [DiffViewModel] for one open diff dialog -- a fresh instance per
 * [DiffTarget], mirroring [RepoPathPicker].
 */
@Composable
private fun DiffDialogHost(
    projectId: String,
    sessionName: String,
    target: DiffTarget,
    onDismiss: () -> Unit,
) {
    val repository: ChangesRepository = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember(target) {
        DiffViewModel(projectId, sessionName, target.file.path, target.mode, repository, scope)
    }
    val state by viewModel.state.collectAsState()

    TmuxDiffDialog(
        fileName = target.file.path,
        statusLabel = target.mode.label,
        statusTone = target.mode.tone,
        state = state,
        onDismiss = onDismiss,
    )
}

/** Hosts [LogsDialogHost] once a service's logs popup is requested -- split out purely to keep [WebMainPane] short. */
@Composable
private fun MainPaneLogsDialog(
    projectId: String?,
    sessionName: String,
    service: String?,
    services: List<ComposeServiceStatus>,
    onDismiss: () -> Unit,
    onSwitchService: (String) -> Unit,
) {
    if (projectId == null || service == null) return
    LogsDialogHost(
        projectId = projectId,
        sessionName = sessionName,
        service = service,
        services = services,
        onDismiss = onDismiss,
        onSwitchService = onSwitchService,
    )
}

/**
 * Owns the [LogsViewModel] for one open logs popup -- a fresh instance per
 * selected service (`remember(service)`), mirroring [DiffDialogHost]. A
 * [DisposableEffect] closes the underlying socket on dismiss/recreate,
 * mirroring [PlatformTerminalView]'s handle-based cleanup elsewhere in this
 * file.
 */
@Composable
private fun LogsDialogHost(
    projectId: String,
    sessionName: String,
    service: String,
    services: List<ComposeServiceStatus>,
    onDismiss: () -> Unit,
    onSwitchService: (String) -> Unit,
) {
    val logsSocket: LogsSocket = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember(projectId, sessionName, service) {
        LogsViewModel(projectId, sessionName, service, logsSocket, scope)
    }
    DisposableEffect(viewModel) { onDispose { viewModel.close() } }
    DisposableEffect(viewModel) {
        val dispose = observeAppForeground {
            if (!viewModel.state.value.isConnected) viewModel.reconnect()
        }
        onDispose(dispose)
    }
    val state by viewModel.state.collectAsState()

    TmuxLogsDialog(
        selectedService = service,
        services = services,
        lines = state.lines,
        isConnected = state.isConnected,
        onDismiss = onDismiss,
        onSwitchService = onSwitchService,
    )
}

private val DiffMode.label: String
    get() = when (this) {
        DiffMode.STAGED -> "staged"
        DiffMode.UNSTAGED -> "unstaged"
        DiffMode.UNTRACKED -> "untracked"
    }

private val DiffMode.tone: TmuxStatusTone
    get() = when (this) {
        DiffMode.STAGED -> TmuxStatusTone.STAGED
        DiffMode.UNSTAGED -> TmuxStatusTone.UNSTAGED
        DiffMode.UNTRACKED -> TmuxStatusTone.UNTRACKED
    }

@Composable
private fun TopBar(
    project: Project?,
    session: ProjectSession,
    environment: EnvStatus?,
    environmentBusy: Boolean,
    railOpen: Boolean,
    onToggleRail: () -> Unit,
    onEnvironmentRun: () -> Unit,
    onEnvironmentStop: () -> Unit,
    onViewLogs: (String) -> Unit,
    onEnvironmentMenuOpenChanged: (Boolean) -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .background(TmuxColors.bgSurface)
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "${project?.name.orEmpty()} / ${session.name}",
            color = TmuxColors.textTertiary,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxTextSize.sm,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        TmuxStatusBadge(
            text = if (session.attached) "attached" else "detached",
            tone = if (session.attached) TmuxStatusTone.ATTACHED else TmuxStatusTone.IDLE,
            dot = session.attached,
        )
        Box(modifier = Modifier.weight(1f))
        TmuxEnvironmentMenu(
            status = environment,
            isBusy = environmentBusy,
            onRun = onEnvironmentRun,
            onStop = onEnvironmentStop,
            onViewLogs = onViewLogs,
            onOpenChanged = onEnvironmentMenuOpenChanged,
        )
        TmuxIconButton(
            TmuxIcons.GitBranch,
            "Changes",
            onToggleRail,
            variant = if (railOpen) TmuxIconButtonVariant.FILLED else TmuxIconButtonVariant.GHOST,
        )
    }
}

@Composable
private fun StatusFooter(session: ProjectSession) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(26.dp)
            .background(TmuxColors.bgSurface)
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        FooterText("${session.windows} windows")
        FooterText("utf-8")
        Box(modifier = Modifier.weight(1f))
        FooterText("^B prefix")
    }
}

@Composable
private fun FooterText(text: String) {
    Text(text, color = TmuxColors.textTertiary, fontFamily = TmuxFonts.mono, fontSize = TmuxTextSize.xs2)
}

@Composable
private fun EmptyMainPane(project: Project?, onNewSession: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(TmuxColors.bgSurface),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                TmuxIcons.Terminal,
                contentDescription = null,
                tint = TmuxColors.textTertiary,
                modifier = Modifier.size(34.dp),
            )
        }
        Text(
            text = if (project != null) "No session selected in ${project.name}" else "Select a session",
            color = TmuxColors.textPrimary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.md,
            fontWeight = TmuxWeight.semibold,
        )
        Text(
            "Pick a session from the sidebar, or start a new one.",
            color = TmuxColors.textTertiary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.sm,
        )
        TmuxButton(
            onClick = onNewSession,
            text = "New session",
            variant = TmuxButtonVariant.PRIMARY,
            icon = TmuxIcons.Plus,
        )
    }
}
