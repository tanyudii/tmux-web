package com.tanyudii.tmuxweb.terminal

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

/**
 * Phase 0 spike screen shared by both platform entry points (wasmJsMain's
 * main.kt, iosMain's MainViewController.kt) — proves [PlatformTerminalView]
 * mounts and round-trips input on each platform via its native embedding
 * (xterm.js on Web, SwiftTerm on iOS). No backend connection here; typed
 * input is echoed straight back into the same terminal. Superseded by the
 * real TerminalScreen in Phase 4 (see .claude/plans/rebuild-web-ios-kmp.plan.md).
 */
@Composable
fun TerminalSpikeScreen() {
    var handle by remember { mutableStateOf<PlatformTerminalHandle?>(null) }
    Box(modifier = Modifier.fillMaxSize()) {
        PlatformTerminalView(
            modifier = Modifier.fillMaxSize(),
            onInput = { text -> handle?.write(text) },
            onBell = {},
            handleReady = { handle = it },
        )
    }
}
