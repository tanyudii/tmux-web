package com.tanyudii.tmuxweb.terminal

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * A platform-native terminal emulator widget embedded inside shared Compose UI.
 * iOS wraps SwiftTerm, Web wraps xterm.js — both via the platform's native-view
 * interop rather than a from-scratch Skia renderer (see plan §3.3 for why).
 *
 * [handleReady] fires once the underlying native terminal is constructed, handing
 * back a [PlatformTerminalHandle] the caller uses to push PTY bytes / resize.
 */
@Composable
expect fun PlatformTerminalView(
    modifier: Modifier,
    onInput: (String) -> Unit,
    onBell: () -> Unit,
    onResize: (cols: Int, rows: Int) -> Unit,
    handleReady: (PlatformTerminalHandle) -> Unit,
)

expect class PlatformTerminalHandle {
    fun write(data: String)
    fun resize(cols: Int, rows: Int)
}
