package com.tanyudii.tmuxweb.ui.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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

    Column(modifier = Modifier.fillMaxSize().background(TmuxColors.bgTerminal)) {
        TmuxNavBar(
            title = title,
            onBack = onBack,
            backLabel = backLabel,
            right = {
                TmuxEnvironmentMenu(
                    status = envState.status,
                    isBusy = envState.isBusy,
                    onRun = environment::setup,
                    onStop = environment::requestStop,
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
