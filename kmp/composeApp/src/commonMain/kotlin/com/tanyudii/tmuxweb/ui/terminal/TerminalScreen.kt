package com.tanyudii.tmuxweb.ui.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.data.remote.terminal.TerminalSocket
import com.tanyudii.tmuxweb.presentation.TerminalViewModel
import com.tanyudii.tmuxweb.terminal.PlatformTerminalHandle
import com.tanyudii.tmuxweb.terminal.PlatformTerminalView
import com.tanyudii.tmuxweb.terminal.triggerBellFeedback
import kotlinx.coroutines.launch
import org.koin.compose.koinInject
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

@Composable
fun TerminalRoute(sessionFullName: String, sessionName: String) {
    val socket: TerminalSocket = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember { TerminalViewModel(socket, scope) }
    val state by viewModel.state.collectAsState()
    var handle by remember { mutableStateOf<PlatformTerminalHandle?>(null) }

    LaunchedEffect(handle) {
        val readyHandle = handle ?: return@LaunchedEffect
        // Start collecting output BEFORE connect(): `output` is a replay=0
        // SharedFlow, so a subscriber that attaches after emissions start
        // would miss the shell's first bytes (prompt / tmux attach output).
        launch { viewModel.output.collect { bytes -> readyHandle.write(bytes.decodeToString()) } }
        viewModel.connect(sessionFullName)
    }
    DisposableEffect(Unit) { onDispose { viewModel.disconnect() } }

    TerminalScreen(
        title = sessionName,
        isConnected = state.isConnected,
        viewModel = viewModel,
        onHandleReady = { handle = it },
    )
}

@OptIn(ExperimentalTime::class)
private fun bellNow(viewModel: TerminalViewModel) {
    val now = Clock.System.now().toEpochMilliseconds()
    if (viewModel.onBell(muted = false, hasFocus = true, hidden = false, now = now)) {
        triggerBellFeedback()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TerminalScreen(
    title: String,
    isConnected: Boolean,
    viewModel: TerminalViewModel,
    onHandleReady: (PlatformTerminalHandle) -> Unit,
) {
    Scaffold(topBar = { TopAppBar(title = { Text(title) }) }) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (!isConnected) {
                Text(
                    "Disconnected — reconnecting…",
                    modifier = Modifier.fillMaxWidth()
                        .background(MaterialTheme.colorScheme.errorContainer)
                        .padding(8.dp),
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
            PlatformTerminalView(
                modifier = Modifier.fillMaxWidth().weight(1f),
                onInput = viewModel::onInput,
                onBell = { bellNow(viewModel) },
                onResize = viewModel::onResize,
                handleReady = onHandleReady,
            )
            QuickKeysBar(onKeyTap = viewModel::onInput)
        }
    }
}
