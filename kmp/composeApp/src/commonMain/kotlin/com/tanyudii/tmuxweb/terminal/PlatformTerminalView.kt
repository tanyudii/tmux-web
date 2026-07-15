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
 *
 * [isVisible] defaults to true and only matters on wasmJs: a native interop
 * DOM element (xterm.js) always paints above Compose-canvas content, including
 * `Popup`/`Dialog`, regardless of composition order — a known Compose
 * Multiplatform Web limitation, not a bug in this app's own layering. Callers
 * showing a modal over the terminal should flip this to false for the
 * duration so the dialog isn't visually covered; the terminal instance itself
 * stays mounted (no reconnect/blank flash) since this only toggles CSS
 * visibility, not composition.
 */
@Composable
expect fun PlatformTerminalView(
    modifier: Modifier,
    onInput: (String) -> Unit,
    onBell: () -> Unit,
    onResize: (cols: Int, rows: Int) -> Unit,
    handleReady: (PlatformTerminalHandle) -> Unit,
    isVisible: Boolean = true,
)

expect class PlatformTerminalHandle {
    fun write(data: String)
    fun resize(cols: Int, rows: Int)
}
