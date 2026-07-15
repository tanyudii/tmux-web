@file:OptIn(ExperimentalWasmJsInterop::class)

package com.tanyudii.tmuxweb.terminal

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.HtmlElementView
import kotlin.js.ExperimentalWasmJsInterop
import kotlinx.browser.document
import kotlinx.browser.window
import org.w3c.dom.HTMLDivElement
import org.w3c.dom.HTMLElement
import org.w3c.dom.events.Event
import org.w3c.dom.events.KeyboardEvent

private const val DEFAULT_FONT_SIZE = 14
private const val MIN_FONT_SIZE = 8
private const val MAX_FONT_SIZE = 32

// Pure mapping, split out of PlatformTerminalView to keep that composable's
// cyclomatic complexity under the project's threshold -- no behavior change.
private fun nextZoomFontSize(key: String, currentSize: Int): Int? = when (key) {
    "=", "+" -> (currentSize + 1).coerceAtMost(MAX_FONT_SIZE)
    "-" -> (currentSize - 1).coerceAtLeast(MIN_FONT_SIZE)
    "0" -> DEFAULT_FONT_SIZE
    else -> null
}

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
    isVisible: Boolean,
) {
    var terminal by remember { mutableStateOf<XtermTerminal?>(null) }
    var fitAddon by remember { mutableStateOf<XtermFitAddon?>(null) }
    var lastCols by remember { mutableStateOf(0) }
    var lastRows by remember { mutableStateOf(0) }
    var fontSize by remember { mutableStateOf(DEFAULT_FONT_SIZE) }

    // Caller keys this composable by session identity (WebMainPane's
    // `key(session.fullName)`) -- dispose the xterm.js instance once per
    // lifetime instead of leaking it when the session switches away.
    DisposableEffect(Unit) { onDispose { terminal?.dispose() } }

    // Shared by the synchronous `update` pass AND the deferred first-fit
    // callback below -- a resize that only happens inside `update` would be
    // silently dropped for the deferred one, since nothing about a plain
    // requestAnimationFrame callback re-triggers Compose's `update` lambda.
    // That gap previously let xterm settle on its real (larger, correctly
    // laid-out) size while the PTY on the server stayed at whatever smaller
    // size was last reported -- tmux kept painting to the old dimensions,
    // leaving a blank strip below the actual content.
    fun reportResizeIfChanged(term: XtermTerminal) {
        if (term.cols != lastCols || term.rows != lastRows) {
            lastCols = term.cols
            lastRows = term.rows
            onResize(term.cols, term.rows)
        }
    }

    HtmlElementView<HTMLDivElement>(
        factory = {
            val container = document.createElement("div") as HTMLDivElement
            container.style.width = "100%"
            container.style.height = "100%"
            // Ctrl/Cmd +/-/0 zoom, same convention as browsers and every
            // desktop terminal emulator. preventDefault() stops the browser's
            // own page-zoom from also firing on the same keystroke.
            container.addEventListener("keydown", { event: Event ->
                val keyEvent = event as KeyboardEvent
                if (!(keyEvent.ctrlKey || keyEvent.metaKey)) return@addEventListener
                val nextSize = nextZoomFontSize(keyEvent.key, fontSize) ?: return@addEventListener
                keyEvent.preventDefault()
                if (nextSize == fontSize) return@addEventListener
                fontSize = nextSize
                val current = terminal ?: return@addEventListener
                setFontSize(current, nextSize)
                fitAddon?.fit()
                reportResizeIfChanged(current)
            })
            // A single deferred fit() (below, in `update`) only catches ONE
            // late layout pass. In practice the container's real settled
            // size can shift more than once after mount -- Compose's own
            // weight()-based reflow of ancestors, web font load, sidebar/
            // rail toggles -- and each of those needs its own re-fit; xterm
            // resizing itself visually without re-fitting is exactly what
            // left tmux painting to a stale, smaller size while the visible
            // black box grew underneath it. ResizeObserver is the actual
            // robust fix: re-fit and re-report on every real size change,
            // not just the first one.
            newResizeObserver {
                val current = terminal ?: return@newResizeObserver
                fitAddon?.fit()
                reportResizeIfChanged(current)
            }.observe(container)
            container
        },
        modifier = modifier.fillMaxSize(),
        update = { container: HTMLDivElement ->
            // visibility (not display:none) so the container keeps its real
            // layout box -- clientWidth/clientHeight (and therefore fit())
            // stay accurate while hidden, instead of collapsing to 0x0 and
            // needing a fresh fit() once shown again.
            val visibility = if (isVisible) "visible" else "hidden"
            container.style.visibility = visibility
            // HtmlElementView wraps `container` in ITS OWN absolutely-positioned
            // outer <div> for interop placement, and that outer div stays
            // `visibility: visible` no matter what we set on `container` --
            // confirmed live via Playwright: with only the line above, the
            // outer wrapper (empty, but still hit-testable at full terminal
            // size) sat on top of every Popup/Dialog opened while a session
            // was active, silently swallowing every click and keystroke aimed
            // at the dialog with no console error, forcing a page reload to
            // recover. Hiding `container.parentElement` too is what actually
            // removes it from hit-testing.
            (container.parentElement as? HTMLElement)?.style?.visibility = visibility
            val current = terminal ?: newTerminal().also { created ->
                val addon = newFitAddon()
                created.loadAddon(addon)
                created.open(container)
                created.onData { data -> onInput(data.toString()) }
                created.onBell { onBell() }
                terminal = created
                fitAddon = addon
                handleReady(PlatformTerminalHandle(created))
                // FitAddon.fit() measures the container's current layout box.
                // Calling it synchronously right after open() races the
                // browser's own layout pass on the just-inserted <div> (often
                // still 0x0 at this point), which renders the terminal with
                // 0 rows/cols -- invisible, no thrown error. Deferring one
                // animation frame lets layout settle before the first fit.
                window.requestAnimationFrame {
                    addon.fit()
                    reportResizeIfChanged(created)
                }
            }
            fitAddon?.fit()
            reportResizeIfChanged(current)
            // Same race as the first-fit comment above, but for LATER layout
            // changes: toggling a sibling (e.g. the changes rail) resizes this
            // container on the same frame this `update` runs in, and that
            // resize can still be mid-flight when the synchronous fit() above
            // reads clientWidth/clientHeight -- leaving stale (blank/gap)
            // dimensions until *something else* happens to trigger another
            // fit(). The ResizeObserver in `factory` normally catches this,
            // but re-fitting one animation frame later here too closes any
            // gap between "container's inline style changed" and "browser
            // actually finished the reflow", without waiting on the observer.
            window.requestAnimationFrame {
                fitAddon?.fit()
                terminal?.let(::reportResizeIfChanged)
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
