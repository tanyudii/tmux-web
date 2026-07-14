package com.tanyudii.tmuxweb

import androidx.compose.ui.window.ComposeUIViewController
import com.tanyudii.tmuxweb.di.initKoin
import com.tanyudii.tmuxweb.terminal.TerminalSpikeScreen
import platform.UIKit.UIViewController

private val koinStarted = KoinStartupGuard()

private class KoinStartupGuard {
    private var started = false

    fun startOnce(start: () -> Unit) {
        if (!started) {
            started = true
            start()
        }
    }
}

// Phase 0 Spike A: TerminalSpikeScreen temporarily replaces App() so SwiftTerm
// embedding can be exercised (see docs/adr/0001-ios-terminal-embedding.md).
// Restored to App() once Phase 4 starts.
@Suppress("FunctionNaming") // standard KMP/Compose-iOS entry-point naming convention
fun MainViewController(): UIViewController {
    koinStarted.startOnce { initKoin() }
    return ComposeUIViewController {
        TerminalSpikeScreen()
    }
}
