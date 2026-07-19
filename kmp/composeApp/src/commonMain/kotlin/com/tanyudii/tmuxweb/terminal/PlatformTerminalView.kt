package com.tanyudii.tmuxweb.terminal

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.tanyudii.tmuxweb.data.remote.terminal.ClientMessage

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
 *
 * [onScroll] fires for trackpad/touch scroll gestures the platform widget
 * captures, so the caller can drive tmux's own copy-mode scrollback (see
 * [com.tanyudii.tmuxweb.presentation.TerminalViewModel.onScroll]) instead of
 * relying on the widget's local scrollback, which doesn't reflect a tmux
 * pane's repaint-by-cursor-addressing rendering correctly. Only the iOS
 * actual wires this up today; it defaults to a no-op elsewhere.
 *
 * [captureSelection] is called right after an Option-held drag selection
 * finishes, and should return the text tmux's own copy-mode just copied
 * (e.g. via [com.tanyudii.tmuxweb.domain.repository.SessionsRepository.pasteBuffer]),
 * or null on failure/nothing to report. Only the wasmJs actual wires this up
 * (see XtermJs.kt's newTerminal() comment for why Option-drag no longer
 * produces a real local selection to read directly); it defaults to a no-op
 * elsewhere.
 */
@Composable
expect fun PlatformTerminalView(
    modifier: Modifier,
    onInput: (String) -> Unit,
    onBell: () -> Unit,
    onResize: (cols: Int, rows: Int) -> Unit,
    handleReady: (PlatformTerminalHandle) -> Unit,
    isVisible: Boolean = true,
    onScroll: (direction: ClientMessage.ScrollDirection, lines: Int) -> Unit = { _, _ -> },
    captureSelection: suspend () -> String? = { null },
)

expect class PlatformTerminalHandle {
    fun write(data: String)
    fun resize(cols: Int, rows: Int)
}
