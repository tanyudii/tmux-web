package com.tanyudii.tmuxweb

import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.window.ComposeViewport
import com.tanyudii.tmuxweb.di.initKoin
import com.tanyudii.tmuxweb.terminal.TerminalSpikeScreen
import kotlinx.browser.document

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    initKoin()
    // Phase 0 Spike B: TerminalSpikeScreen temporarily replaces App() as the root
    // composable so the xterm.js embedding can be exercised end to end (see
    // docs/adr/0002-web-terminal-embedding.md). Restored to App() once Phase 4 starts.
    ComposeViewport(document.body!!) {
        TerminalSpikeScreen()
    }
}
