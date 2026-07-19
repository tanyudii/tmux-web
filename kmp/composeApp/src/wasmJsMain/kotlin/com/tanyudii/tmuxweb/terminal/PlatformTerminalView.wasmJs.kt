@file:OptIn(ExperimentalWasmJsInterop::class)

package com.tanyudii.tmuxweb.terminal

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.HtmlElementView
import com.tanyudii.tmuxweb.data.remote.terminal.ClientMessage
import com.tanyudii.tmuxweb.domain.accumulateScrollLines
import kotlin.js.ExperimentalWasmJsInterop
import kotlin.math.abs
import kotlinx.browser.document
import kotlinx.browser.window
import org.w3c.dom.HTMLDivElement
import org.w3c.dom.HTMLElement

// Turns touch drags into tmux copy-mode scroll reports. See attachTouchScroll
// (XtermJs.kt) for why xterm's own touch handling can't do this, and
// accumulateScrollLines (domain/TerminalScroll.kt) for the pixels->lines math
// this shares with the iOS actual.
//
// `onScroll` is read through a getter rather than captured by value: this runs
// from `factory`, which Compose invokes exactly once, so capturing the callback
// directly would pin the very first composition's lambda forever.
private fun attachScrollHandling(
    container: HTMLDivElement,
    terminal: () -> XtermTerminal?,
    onScroll: () -> (ClientMessage.ScrollDirection, Int) -> Unit,
) {
    var carry = 0.0
    attachTouchScroll(
        container = container,
        onStart = { carry = 0.0 },
        onDrag = { deltaY ->
            val rows = terminal()?.rows ?: 0
            val pixelsPerLine = if (rows > 0) container.clientHeight.toDouble() / rows else 0.0
            // Dragging DOWN reveals earlier output -- i.e. scrolls UP into
            // history -- so the raw finger delta is negated into
            // accumulateScrollLines' "positive = down" convention. Same sign
            // flip as SwiftTermViewFactory.swift's handleScrollPan.
            val result = accumulateScrollLines(-deltaY, pixelsPerLine, carry)
            carry = result.carry
            if (result.lines != 0) {
                val direction = if (result.lines < 0) {
                    ClientMessage.ScrollDirection.UP
                } else {
                    ClientMessage.ScrollDirection.DOWN
                }
                onScroll()(direction, abs(result.lines))
            }
        },
    )
}

// A single deferred fit() (in the composable's `update` lambda) only
// catches ONE late layout pass. In practice the container's real settled
// size can shift more than once after mount -- Compose's own
// weight()-based reflow of ancestors, web font load, sidebar/rail toggles
// -- and each of those needs its own re-fit; xterm resizing itself
// visually without re-fitting is exactly what left tmux painting to a
// stale, smaller size while the visible black box grew underneath it.
// ResizeObserver is the actual robust fix: re-fit and re-report on every
// real size change, not just the first one.
private fun attachResizeObserver(
    container: HTMLDivElement,
    terminal: () -> XtermTerminal?,
    fitAddon: () -> XtermFitAddon?,
    reportResizeIfChanged: (XtermTerminal) -> Unit,
) {
    newResizeObserver {
        val current = terminal() ?: return@newResizeObserver
        fitAddon()?.fit()
        reportResizeIfChanged(current)
    }.observe(container)
}

// FitAddon.fit() measures the container's current layout box. Calling it
// synchronously right after open() races the browser's own layout pass on
// the just-inserted <div> (often still 0x0 at this point), which renders
// the terminal with 0 rows/cols -- invisible, no thrown error. Deferring
// one animation frame lets layout settle before the first fit.
private fun createAndMountTerminal(
    container: HTMLDivElement,
    onInput: (String) -> Unit,
    onBell: () -> Unit,
    onReady: (created: XtermTerminal, addon: XtermFitAddon, search: XtermSearchAddon) -> Unit,
    onFirstFit: (created: XtermTerminal, addon: XtermFitAddon) -> Unit,
): XtermTerminal {
    val created = newTerminal()
    val addon = newFitAddon()
    val search = newSearchAddon()
    created.loadAddon(addon)
    created.loadAddon(search)
    created.open(container)
    created.onData { data -> onInput(data.toString()) }
    created.onBell { onBell() }
    onReady(created, addon, search)
    window.requestAnimationFrame { onFirstFit(created, addon) }
    return created
}

/**
 * Get/set access to the composable's `remember`ed terminal/fitAddon state.
 * Bundled (rather than four separate params) to stay under detekt's
 * parameter-count limit.
 */
private class TerminalRefs(
    val terminal: () -> XtermTerminal?,
    val setTerminal: (XtermTerminal) -> Unit,
    val fitAddon: () -> XtermFitAddon?,
    val setFitAddon: (XtermFitAddon) -> Unit,
    val setSearchAddon: (XtermSearchAddon) -> Unit,
)

/** The composable's stable callback params. Bundled for the same reason as [TerminalRefs]. */
private class TerminalCallbacks(
    val onInput: (String) -> Unit,
    val onBell: () -> Unit,
    val handleReady: (PlatformTerminalHandle) -> Unit,
    val reportResizeIfChanged: (XtermTerminal) -> Unit,
)

private fun updateTerminalContainer(
    container: HTMLDivElement,
    isVisible: Boolean,
    refs: TerminalRefs,
    callbacks: TerminalCallbacks,
) {
    // visibility (not display:none) so the container keeps its real layout
    // box -- clientWidth/clientHeight (and therefore fit()) stay accurate
    // while hidden, instead of collapsing to 0x0 and needing a fresh fit()
    // once shown again.
    val visibility = if (isVisible) "visible" else "hidden"
    container.style.visibility = visibility
    // A failure toast has no auto-dismiss timer (see showCopyToast) -- stop
    // it from silently resurfacing with a stale message next time the
    // container becomes visible again (e.g. after a Popup/Dialog closes)
    // when hiding it now for an unrelated reason.
    if (!isVisible) hideCopyToast(container)
    // Same reasoning, plus a sharper risk: an already-focused search
    // `<input>` is a real, independently-focusable DOM element, so leaving
    // it up (and possibly still focused) underneath a just-opened Popup/
    // Dialog risks exactly the focus-trap class of bug already hit once in
    // this codebase (see the container.parentElement fix below) -- close it
    // outright rather than relying on `visibility: hidden` to also blur it,
    // which isn't guaranteed across browsers.
    if (!isVisible) hideSearchBar(container)
    // HtmlElementView wraps `container` in ITS OWN absolutely-positioned
    // outer <div> for interop placement, and that outer div stays
    // `visibility: visible` no matter what we set on `container` --
    // confirmed live via Playwright: with only the line above, the outer
    // wrapper (empty, but still hit-testable at full terminal size) sat on
    // top of every Popup/Dialog opened while a session was active, silently
    // swallowing every click and keystroke aimed at the dialog with no
    // console error, forcing a page reload to recover. Hiding
    // `container.parentElement` too is what actually removes it from
    // hit-testing.
    (container.parentElement as? HTMLElement)?.style?.visibility = visibility
    val current = refs.terminal() ?: createAndMountTerminal(
        container = container,
        onInput = callbacks.onInput,
        onBell = callbacks.onBell,
        onReady = { created, addon, search ->
            refs.setTerminal(created)
            refs.setFitAddon(addon)
            refs.setSearchAddon(search)
            callbacks.handleReady(PlatformTerminalHandle(created))
        },
        onFirstFit = { created, addon ->
            addon.fit()
            callbacks.reportResizeIfChanged(created)
        },
    )
    refs.fitAddon()?.fit()
    callbacks.reportResizeIfChanged(current)
    // Same race as createAndMountTerminal's first-fit comment, but for
    // LATER layout changes: toggling a sibling (e.g. the changes rail)
    // resizes this container on the same frame this runs in, and that
    // resize can still be mid-flight when the synchronous fit() above reads
    // clientWidth/clientHeight -- leaving stale (blank/gap) dimensions
    // until *something else* happens to trigger another fit(). The
    // ResizeObserver in `factory` normally catches this, but re-fitting one
    // animation frame later here too closes any gap between "container's
    // inline style changed" and "browser actually finished the reflow",
    // without waiting on the observer.
    window.requestAnimationFrame {
        refs.fitAddon()?.fit()
        refs.terminal()?.let(callbacks.reportResizeIfChanged)
    }
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
    // Wired for touch drags only (see attachScrollHandling). A real wheel or
    // trackpad already reaches tmux without us: xterm.js forwards wheel events
    // as SGR mouse escape sequences, and tmux -- running with `mouse on` --
    // acts on those itself. Touch is the gap, because xterm emits no wheel
    // event for a finger drag.
    onScroll: (direction: ClientMessage.ScrollDirection, lines: Int) -> Unit,
) {
    var terminal by remember { mutableStateOf<XtermTerminal?>(null) }
    var fitAddon by remember { mutableStateOf<XtermFitAddon?>(null) }
    var searchAddon by remember { mutableStateOf<XtermSearchAddon?>(null) }
    var lastCols by remember { mutableStateOf(0) }
    var lastRows by remember { mutableStateOf(0) }
    var fontSize by remember { mutableStateOf(DEFAULT_FONT_SIZE) }
    // `factory` below runs once, but this callback can change identity on any
    // recomposition -- rememberUpdatedState keeps the touch handler reading the
    // current one instead of the one that happened to exist at mount.
    val currentOnScroll = rememberUpdatedState(onScroll)

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
            container.style.position = "relative"
            // EMB-219: the search shortcut is registered separately, in the
            // CAPTURE phase, by attachTerminalKeydownListeners below --
            // confirmed live that xterm.js's own internal keydown handler
            // (on its hidden textarea, the actual event *target*) treats
            // Ctrl+F as the VT control character ^F and stopPropagation()s
            // it before a bubble-phase listener on `container` would ever
            // see it (Cmd+F worked fine, since metaKey isn't in xterm's
            // Ctrl-letter VT keymap). A capture-phase listener on an
            // ancestor is the only way to intercept ahead of xterm's own
            // handling.
            attachTerminalKeydownListeners(
                container = container,
                terminal = { terminal },
                searchAddon = { searchAddon },
                fontSize = { fontSize },
                onZoomApplied = { current, nextSize ->
                    fontSize = nextSize
                    setFontSize(current, nextSize)
                    fitAddon?.fit()
                    reportResizeIfChanged(current)
                },
            )
            attachResizeObserver(container, { terminal }, { fitAddon }, ::reportResizeIfChanged)
            attachScrollHandling(container, { terminal }, { currentOnScroll.value })
            container
        },
        modifier = modifier.fillMaxSize(),
        update = { container: HTMLDivElement ->
            updateTerminalContainer(
                container = container,
                isVisible = isVisible,
                refs = TerminalRefs(
                    terminal = { terminal },
                    setTerminal = { terminal = it },
                    fitAddon = { fitAddon },
                    setFitAddon = { fitAddon = it },
                    setSearchAddon = { searchAddon = it },
                ),
                callbacks = TerminalCallbacks(
                    onInput = onInput,
                    onBell = onBell,
                    handleReady = handleReady,
                    reportResizeIfChanged = ::reportResizeIfChanged,
                ),
            )
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
