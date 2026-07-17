package com.tanyudii.tmuxweb.ui.terminal

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.tanyudii.tmuxweb.data.remote.terminal.ClientMessage
import com.tanyudii.tmuxweb.data.remote.terminal.TerminalSocket
import com.tanyudii.tmuxweb.domain.buildBellTitle
import com.tanyudii.tmuxweb.domain.hasWindowFocus
import com.tanyudii.tmuxweb.domain.isPageHidden
import com.tanyudii.tmuxweb.presentation.TerminalViewModel
import com.tanyudii.tmuxweb.terminal.PlatformTerminalHandle
import com.tanyudii.tmuxweb.terminal.observeAppForeground
import com.tanyudii.tmuxweb.terminal.triggerBellFeedback
import kotlinx.coroutines.launch
import org.koin.compose.koinInject
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

/**
 * Owns one session's `TerminalViewModel` + socket lifecycle so both the
 * mobile [TerminalRoute] and the Web shell's terminal pane can embed
 * [com.tanyudii.tmuxweb.terminal.PlatformTerminalView] against the same
 * wiring (connect on native-view ready, disconnect on dispose, bell
 * cooldown) without duplicating it — see [TerminalViewModel] for the
 * business logic this drives.
 */
class TerminalSession internal constructor(
    val viewModel: TerminalViewModel,
    val isConnected: Boolean,
    val onHandleReady: (PlatformTerminalHandle) -> Unit,
    private val sessionLabel: String,
) {
    fun onInput(text: String) = viewModel.onInput(text)

    fun onResize(cols: Int, rows: Int) = viewModel.onResize(cols, rows)

    /** Manual fallback for the connection banner's "Retry" action -- see TmuxConnectionBanner. */
    fun onRetry() = viewModel.reconnect()

    fun onScroll(direction: ClientMessage.ScrollDirection, lines: Int) = viewModel.onScroll(direction, lines)

    @OptIn(ExperimentalTime::class)
    fun onBell() {
        val now = Clock.System.now().toEpochMilliseconds()
        if (viewModel.onBell(muted = false, hasFocus = hasWindowFocus(), hidden = isPageHidden(), now = now)) {
            triggerBellFeedback(buildBellTitle(sessionLabel))
        }
    }
}

/**
 * [pane] 0 (default) is the primary viewport; 1 is the EMB-217 split
 * viewport, which attaches to its own linked tmux session (see
 * TerminalSocket.connect) -- keying every `remember` here on both
 * [sessionFullName] and [pane] is what gives the split its own independent
 * [TerminalViewModel]/socket/handle instead of accidentally sharing pane
 * 0's.
 */
@Composable
fun rememberTerminalSession(sessionFullName: String, pane: Int = 0): TerminalSession {
    val socket: TerminalSocket = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember(sessionFullName, pane) { TerminalViewModel(socket, scope) }
    val state by viewModel.state.collectAsState()
    var handle by remember(sessionFullName, pane) { mutableStateOf<PlatformTerminalHandle?>(null) }
    // sessionFullName is "<projectId>__<sessionSlug>" (see backend's
    // session-naming.ts SESSION_NAME_SEPARATOR) -- the slug is the
    // human-readable part, so it's what buildBellTitle should show rather
    // than the opaque project-id-prefixed full name.
    val sessionLabel = remember(sessionFullName) { sessionFullName.substringAfter("__", sessionFullName) }

    LaunchedEffect(handle) {
        val readyHandle = handle ?: return@LaunchedEffect
        // Start collecting output BEFORE connect(): `output` is a replay=0
        // SharedFlow, so a subscriber that attaches after emissions start
        // would miss the shell's first bytes (prompt / tmux attach output).
        launch { viewModel.output.collect { bytes -> readyHandle.write(bytes.decodeToString()) } }
        viewModel.connect(sessionFullName, pane)
    }
    DisposableEffect(sessionFullName, pane) { onDispose { viewModel.disconnect() } }
    // Fast path for the reported iOS Safari bug (and the equivalent gap on
    // the native iOS app, see AppForegroundObserver.ios.kt): the moment the
    // tab/app comes back to the foreground, try to reconnect immediately
    // instead of waiting out TerminalViewModel's own backoff timer (see
    // TerminalViewModel.scheduleReconnect for the general-case fallback).
    DisposableEffect(viewModel) {
        val dispose = observeAppForeground {
            if (!viewModel.state.value.isConnected) viewModel.reconnect()
        }
        onDispose(dispose)
    }

    return remember(viewModel, state.isConnected, sessionLabel) {
        TerminalSession(
            viewModel = viewModel,
            isConnected = state.isConnected,
            onHandleReady = { handle = it },
            sessionLabel = sessionLabel,
        )
    }
}
