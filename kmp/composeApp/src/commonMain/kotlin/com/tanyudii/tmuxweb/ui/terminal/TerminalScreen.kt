package com.tanyudii.tmuxweb.ui.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.tanyudii.tmuxweb.data.remote.logs.LogsSocket
import com.tanyudii.tmuxweb.data.remote.terminal.ClientMessage
import com.tanyudii.tmuxweb.domain.model.ComposeServiceStatus
import com.tanyudii.tmuxweb.domain.repository.ChangesRepository
import com.tanyudii.tmuxweb.domain.repository.EnvironmentRepository
import com.tanyudii.tmuxweb.domain.repository.SessionsRepository
import com.tanyudii.tmuxweb.presentation.ChangesViewModel
import com.tanyudii.tmuxweb.presentation.EnvironmentUiState
import com.tanyudii.tmuxweb.presentation.EnvironmentViewModel
import com.tanyudii.tmuxweb.presentation.LogsViewModel
import com.tanyudii.tmuxweb.terminal.PlatformTerminalHandle
import com.tanyudii.tmuxweb.terminal.PlatformTerminalView
import com.tanyudii.tmuxweb.terminal.observeAppForeground
import com.tanyudii.tmuxweb.ui.components.TmuxConfirmDialog
import com.tanyudii.tmuxweb.ui.components.TmuxConnectionBanner
import com.tanyudii.tmuxweb.ui.components.TmuxConnectionStatus
import com.tanyudii.tmuxweb.ui.components.TmuxEnvironmentMenu
import com.tanyudii.tmuxweb.ui.components.TmuxLogsDialog
import com.tanyudii.tmuxweb.ui.components.TmuxNavBar
import com.tanyudii.tmuxweb.ui.components.TmuxNavBarBack
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import org.koin.compose.koinInject

@Composable
fun TerminalRoute(
    sessionFullName: String,
    sessionName: String,
    projectId: String,
    projectName: String,
    onBack: () -> Unit,
) {
    val session = rememberTerminalSession(sessionFullName)
    val environment = rememberEnvironment(projectId, sessionName)
    val changes = rememberChanges(projectId, sessionName)
    val sessionsRepository: SessionsRepository = koinInject()

    TerminalScreen(
        title = sessionName,
        backLabel = projectName,
        isConnected = session.isConnected,
        environment = environment,
        changes = changes,
        projectId = projectId,
        sessionName = sessionName,
        onInput = session::onInput,
        onResize = session::onResize,
        onBell = session::onBell,
        onScroll = session::onScroll,
        // See PlatformTerminalView's captureSelection kdoc -- relays tmux's
        // paste buffer (an Option-drag's real copy-mode selection) so
        // Cmd+C can write it to the OS clipboard.
        captureSelection = { runCatching { sessionsRepository.pasteBuffer(projectId, sessionName) }.getOrNull() },
        onHandleReady = session.onHandleReady,
        onRetry = session::onRetry,
        onBack = onBack,
    )
}

/** Terminal screen — ports `ui_kits/ios/app.jsx`'s `TerminalScreen`. */
@Composable
private fun TerminalScreen(
    title: String,
    backLabel: String,
    isConnected: Boolean,
    environment: EnvironmentViewModel,
    changes: ChangesViewModel,
    projectId: String,
    sessionName: String,
    onInput: (String) -> Unit,
    onResize: (cols: Int, rows: Int) -> Unit,
    onBell: () -> Unit,
    onScroll: (direction: ClientMessage.ScrollDirection, lines: Int) -> Unit,
    captureSelection: suspend () -> String?,
    onHandleReady: (PlatformTerminalHandle) -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    val envState by environment.state.collectAsState()
    val changesState by changes.state.collectAsState()
    // The terminal's native DOM element must be hidden for the duration of any
    // Popup/Dialog rendered over it (environment dropdown, stop-confirm,
    // EMB-225's Changes dialog) -- see PlatformTerminalView's `isVisible`
    // kdoc and WebMainPane.kt's mirror of this same gating. Omitting it here
    // left this screen's terminal always-visible, letting its DOM overlay
    // swallow clicks/keystrokes meant for the dialog on top of it
    // (CLAUDE.md's flagged incident class).
    var environmentMenuOpen by remember { mutableStateOf(false) }
    var changesOpen by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().background(TmuxColors.bgTerminal)) {
        TmuxNavBar(
            title = title,
            back = TmuxNavBarBack(label = backLabel, onClick = onBack),
            right = {
                ChangesNavButton(changes = changesState.changes, onClick = { changesOpen = true })
                TmuxEnvironmentMenu(
                    status = envState.status,
                    isBusy = envState.isBusy,
                    onRun = environment::setup,
                    onStop = environment::requestStop,
                    onViewLogs = environment::showLogs,
                    onOpenChanged = { environmentMenuOpen = it },
                    onCancel = environment::cancel,
                )
            },
        )
        if (!isConnected) {
            TmuxConnectionBanner(
                status = TmuxConnectionStatus.RECONNECTING,
                message = "Reconnecting…",
                onRetry = onRetry,
            )
        }
        val terminalVisible = !environmentMenuOpen && !envState.isShowingStopConfirm && !changesOpen &&
            envState.logsService == null
        PlatformTerminalView(
            modifier = Modifier.fillMaxWidth().weight(1f),
            onInput = onInput,
            onBell = onBell,
            onResize = onResize,
            handleReady = onHandleReady,
            isVisible = terminalVisible,
            onScroll = onScroll,
            captureSelection = captureSelection,
        )
        QuickKeysBar(onKeyTap = onInput)
    }

    TerminalScreenDialogs(
        environment = environment,
        changes = changes,
        envState = envState,
        projectId = projectId,
        sessionName = sessionName,
        changesOpen = changesOpen,
        onChangesDismiss = { changesOpen = false },
    )
}

/**
 * Stop-confirm / logs / Changes dialogs -- split out of [TerminalScreen]
 * purely to keep that composable under the project's detekt LongMethod
 * threshold, no behavior change.
 */
@Composable
private fun TerminalScreenDialogs(
    environment: EnvironmentViewModel,
    changes: ChangesViewModel,
    envState: EnvironmentUiState,
    projectId: String,
    sessionName: String,
    changesOpen: Boolean,
    onChangesDismiss: () -> Unit,
) {
    if (envState.isShowingStopConfirm) {
        TmuxConfirmDialog(
            title = "Stop environment?",
            message = "All running services will be stopped.",
            confirmLabel = "Stop",
            onConfirm = environment::stop,
            onCancel = environment::cancelStop,
        )
    }

    envState.logsService?.let { service ->
        TerminalLogsDialog(
            projectId = projectId,
            sessionName = sessionName,
            service = service,
            services = envState.status?.services.orEmpty(),
            onDismiss = environment::hideLogs,
            onSwitchService = environment::switchLogsService,
        )
    }

    if (changesOpen) {
        ChangesDialog(
            projectId = projectId,
            sessionName = sessionName,
            changes = changes,
            onDismiss = onChangesDismiss,
        )
    }
}

/**
 * Owns one [LogsViewModel] per selected service -- `remember(service)` means
 * switching services (via [TmuxLogsDialog]'s header dropdown) tears down the
 * old socket and starts a fresh one automatically, same lifecycle idiom as
 * [rememberEnvironment] below. [DisposableEffect] closes the socket when the
 * dialog is dismissed or the composable leaves the tree, mirroring the
 * `handleReady`/close cleanup [PlatformTerminalView] already relies on.
 */
@Composable
private fun TerminalLogsDialog(
    projectId: String,
    sessionName: String,
    service: String,
    services: List<ComposeServiceStatus>,
    onDismiss: () -> Unit,
    onSwitchService: (String) -> Unit,
) {
    val logsSocket: LogsSocket = koinInject()
    val scope = rememberCoroutineScope()
    val logsViewModel = remember(projectId, sessionName, service) {
        LogsViewModel(projectId, sessionName, service, logsSocket, scope)
    }
    DisposableEffect(logsViewModel) { onDispose { logsViewModel.close() } }
    DisposableEffect(logsViewModel) {
        val dispose = observeAppForeground {
            if (!logsViewModel.state.value.isConnected) logsViewModel.reconnect()
        }
        onDispose(dispose)
    }
    val logsState by logsViewModel.state.collectAsState()

    TmuxLogsDialog(
        selectedService = service,
        services = services,
        lines = logsState.lines,
        isConnected = logsState.isConnected,
        onDismiss = onDismiss,
        onSwitchService = onSwitchService,
    )
}

/**
 * EMB-225: owned at [TerminalRoute] level (not inside [ChangesDialog]) so
 * its 5s poll keeps [ChangesNavButton]'s badge count fresh even while the
 * dialog is closed, the same lifecycle idiom as [rememberEnvironment].
 */
@Composable
private fun rememberChanges(projectId: String, sessionName: String): ChangesViewModel {
    val repository: ChangesRepository = koinInject()
    val scope = rememberCoroutineScope()
    return remember(projectId, sessionName) { ChangesViewModel(projectId, sessionName, repository, scope) }
}

@Composable
private fun rememberEnvironment(projectId: String, sessionName: String): EnvironmentViewModel {
    val repository: EnvironmentRepository = koinInject()
    val scope = rememberCoroutineScope()
    return remember(projectId, sessionName) { EnvironmentViewModel(projectId, sessionName, repository, scope) }
}
