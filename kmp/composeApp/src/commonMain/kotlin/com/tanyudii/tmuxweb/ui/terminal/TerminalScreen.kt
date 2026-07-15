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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.terminal.PlatformTerminalHandle
import com.tanyudii.tmuxweb.terminal.PlatformTerminalView

@Composable
fun TerminalRoute(sessionFullName: String, sessionName: String) {
    val session = rememberTerminalSession(sessionFullName)

    TerminalScreen(
        title = sessionName,
        isConnected = session.isConnected,
        onInput = session::onInput,
        onResize = session::onResize,
        onBell = session::onBell,
        onHandleReady = session.onHandleReady,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TerminalScreen(
    title: String,
    isConnected: Boolean,
    onInput: (String) -> Unit,
    onResize: (cols: Int, rows: Int) -> Unit,
    onBell: () -> Unit,
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
                onInput = onInput,
                onBell = onBell,
                onResize = onResize,
                handleReady = onHandleReady,
            )
            QuickKeysBar(onKeyTap = onInput)
        }
    }
}
