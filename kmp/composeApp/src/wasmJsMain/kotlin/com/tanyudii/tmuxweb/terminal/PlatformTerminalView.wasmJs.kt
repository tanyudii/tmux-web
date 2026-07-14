@file:OptIn(ExperimentalWasmJsInterop::class)

package com.tanyudii.tmuxweb.terminal

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
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
    handleReady: (PlatformTerminalHandle) -> Unit,
) {
    HtmlElementView<HTMLDivElement>(
        factory = {
            val container = document.createElement("div") as HTMLDivElement
            container.style.width = "100%"
            container.style.height = "100%"
            container
        },
        modifier = modifier.fillMaxSize(),
        update = { container: HTMLDivElement ->
            if (container.childElementCount == 0) {
                val terminal = newTerminal()
                val fitAddon = newFitAddon()
                terminal.loadAddon(fitAddon)
                terminal.open(container)
                fitAddon.fit()
                terminal.onData { data -> onInput(data.toString()) }
                terminal.onBell { onBell() }
                handleReady(PlatformTerminalHandle(terminal))
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
