package com.tanyudii.tmuxweb.ui.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.tanyudii.tmuxweb.domain.repository.EnvironmentRepository
import com.tanyudii.tmuxweb.presentation.EnvironmentViewModel
import com.tanyudii.tmuxweb.terminal.PlatformTerminalHandle
import com.tanyudii.tmuxweb.terminal.PlatformTerminalView
import com.tanyudii.tmuxweb.ui.components.TmuxConfirmDialog
import com.tanyudii.tmuxweb.ui.components.TmuxConnectionBanner
import com.tanyudii.tmuxweb.ui.components.TmuxConnectionStatus
import com.tanyudii.tmuxweb.ui.components.TmuxEnvironmentMenu
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

    TerminalScreen(
        title = sessionName,
        backLabel = projectName,
        isConnected = session.isConnected,
        environment = environment,
        onInput = session::onInput,
        onResize = session::onResize,
        onBell = session::onBell,
        onHandleReady = session.onHandleReady,
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
    onInput: (String) -> Unit,
    onResize: (cols: Int, rows: Int) -> Unit,
    onBell: () -> Unit,
    onHandleReady: (PlatformTerminalHandle) -> Unit,
    onBack: () -> Unit,
) {
    val envState by environment.state.collectAsState()
    // The terminal's native DOM element must be hidden for the duration of any
    // Popup/Dialog rendered over it (environment dropdown, stop-confirm) --
    // see PlatformTerminalView's `isVisible` kdoc and WebMainPane.kt's mirror
    // of this same gating. Omitting it here left this screen's terminal
    // always-visible, letting its DOM overlay swallow clicks/keystrokes meant
    // for the dialog on top of it (CLAUDE.md's flagged incident class).
    var environmentMenuOpen by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().background(TmuxColors.bgTerminal)) {
        TmuxNavBar(
            title = title,
            back = TmuxNavBarBack(label = backLabel, onClick = onBack),
            right = {
                TmuxEnvironmentMenu(
                    status = envState.status,
                    isBusy = envState.isBusy,
                    onRun = environment::setup,
                    onStop = environment::requestStop,
                    onOpenChanged = { environmentMenuOpen = it },
                )
            },
        )
        if (!isConnected) {
            TmuxConnectionBanner(status = TmuxConnectionStatus.RECONNECTING, message = "Reconnecting…")
        }
        PlatformTerminalView(
            modifier = Modifier.fillMaxWidth().weight(1f),
            onInput = onInput,
            onBell = onBell,
            onResize = onResize,
            handleReady = onHandleReady,
            isVisible = !environmentMenuOpen && !envState.isShowingStopConfirm,
        )
        QuickKeysBar(onKeyTap = onInput)
    }

    if (envState.isShowingStopConfirm) {
        TmuxConfirmDialog(
            title = "Stop environment?",
            message = "All running services will be stopped.",
            confirmLabel = "Stop",
            onConfirm = environment::stop,
            onCancel = environment::cancelStop,
        )
    }
}

@Composable
private fun rememberEnvironment(projectId: String, sessionName: String): EnvironmentViewModel {
    val repository: EnvironmentRepository = koinInject()
    val scope = rememberCoroutineScope()
    return remember(projectId, sessionName) { EnvironmentViewModel(projectId, sessionName, repository, scope) }
}
