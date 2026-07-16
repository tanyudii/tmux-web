package com.tanyudii.tmuxweb.terminal

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.UIKitView
import com.tanyudii.tmuxweb.data.remote.terminal.ClientMessage

// iOS actual for the expect in PlatformTerminalView.kt — Spike A. UNVERIFIED
// locally (no macOS in this dev environment); see
// docs/adr/0001-ios-terminal-embedding.md and .github/workflows/kmp-ci.yml
// (macos-15 job) for how this gets checked. Kotlin never references SwiftTerm
// directly — it only calls whatever factory iosApp (Swift) registered into
// TerminalViewProvider before ComposeUIViewController was created.
@OptIn(ExperimentalComposeUiApi::class)
@Composable
actual fun PlatformTerminalView(
    modifier: Modifier,
    onInput: (String) -> Unit,
    onBell: () -> Unit,
    onResize: (cols: Int, rows: Int) -> Unit,
    handleReady: (PlatformTerminalHandle) -> Unit,
    isVisible: Boolean,
    onScroll: (direction: ClientMessage.ScrollDirection, lines: Int) -> Unit,
) {
    // isVisible is a web-only workaround (see kdoc on the expect declaration)
    // for interop DOM views always painting above Compose Popups -- native
    // UIKit modals already z-order correctly above sibling UIViews, so
    // there's nothing to do with it here.
    val factory = requireNotNull(TerminalViewProvider.factory) {
        "TerminalViewProvider.factory was never set. iosApp must register it " +
            "(see iosApp/iosApp/Terminal/SwiftTermViewFactory.swift) before " +
            "creating MainViewController()."
    }
    UIKitView(
        factory = {
            val view = factory.createTerminalView(onInput, onBell, onResize) { direction, lines ->
                // Swift crosses direction as a plain "up"/"down" string (see
                // TerminalViewFactory.kt's onScroll kdoc for why); this is
                // the one place that maps it back onto the shared enum.
                val scrollDirection = when (direction) {
                    "up" -> ClientMessage.ScrollDirection.UP
                    else -> ClientMessage.ScrollDirection.DOWN
                }
                onScroll(scrollDirection, lines)
            }
            val handle = view as? TerminalViewHandle
                ?: error(
                    "${view::class} must conform to TerminalViewHandle " +
                        "(Swift: `class Foo: UIView, TerminalViewHandle`)",
                )
            handleReady(PlatformTerminalHandle(handle))
            view
        },
        modifier = modifier.fillMaxSize(),
    )
}

actual class PlatformTerminalHandle(private val handle: TerminalViewHandle) {
    actual fun write(data: String) {
        handle.write(data)
    }

    actual fun resize(cols: Int, rows: Int) {
        handle.resize(cols, rows)
    }
}
