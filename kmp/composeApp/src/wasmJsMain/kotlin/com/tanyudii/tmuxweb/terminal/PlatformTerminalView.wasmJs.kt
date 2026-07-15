@file:OptIn(ExperimentalWasmJsInterop::class)

package com.tanyudii.tmuxweb.terminal

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.HtmlElementView
import kotlin.js.ExperimentalWasmJsInterop
import kotlinx.browser.document
import org.w3c.dom.HTMLDivElement

// wasmJs actual for the expect in PlatformTerminalView.kt — this is Spike B
// (xterm.js via HtmlElementView) formalized behind the common API. See
// docs/adr/0002-web-terminal-embedding.md; verified end-to-end with a real
// headless-Chrome round trip (keyboard input -> onData -> local echo).
@OptIn(ExperimentalComposeUiApi::class)
@Composable
actual fun PlatformTerminalView(
    modifier: Modifier,
    onInput: (String) -> Unit,
    onBell: () -> Unit,
    onResize: (cols: Int, rows: Int) -> Unit,
    handleReady: (PlatformTerminalHandle) -> Unit,
) {
    var terminal by remember { mutableStateOf<XtermTerminal?>(null) }
    var fitAddon by remember { mutableStateOf<XtermFitAddon?>(null) }
    var lastCols by remember { mutableStateOf(0) }
    var lastRows by remember { mutableStateOf(0) }

    HtmlElementView<HTMLDivElement>(
        factory = {
            val container = document.createElement("div") as HTMLDivElement
            container.style.width = "100%"
            container.style.height = "100%"
            container
        },
        modifier = modifier.fillMaxSize(),
        update = { container: HTMLDivElement ->
            val current = terminal ?: newTerminal().also { created ->
                val addon = newFitAddon()
                created.loadAddon(addon)
                created.open(container)
                created.onData { data -> onInput(data.toString()) }
                created.onBell { onBell() }
                terminal = created
                fitAddon = addon
                handleReady(PlatformTerminalHandle(created))
            }
            fitAddon?.fit()
            if (current.cols != lastCols || current.rows != lastRows) {
                lastCols = current.cols
                lastRows = current.rows
                onResize(current.cols, current.rows)
            }
        },
    )
}

actual class PlatformTerminalHandle(private val terminal: XtermTerminal) {
    actual fun write(data: String) {
        terminal.write(data.toJsString())
    }

    actual fun resize(cols: Int, rows: Int) {
        terminal.resize(cols, rows)
    }
}
