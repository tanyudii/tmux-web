package com.tanyudii.tmuxweb.terminal

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier

// Coverage-only target (see composeApp/build.gradle.kts) — no real terminal
// widget ships from this target, so this renders an empty box and hands back
// a no-op handle purely to satisfy the expect/actual contract.
@Composable
actual fun PlatformTerminalView(
    modifier: Modifier,
    onInput: (String) -> Unit,
    onBell: () -> Unit,
    onResize: (cols: Int, rows: Int) -> Unit,
    handleReady: (PlatformTerminalHandle) -> Unit,
    isVisible: Boolean,
) {
    LaunchedEffect(Unit) { handleReady(PlatformTerminalHandle()) }
    Box(modifier = modifier)
}

actual class PlatformTerminalHandle {
    actual fun write(data: String) {}

    actual fun resize(cols: Int, rows: Int) {}
}
