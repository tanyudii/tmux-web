@file:OptIn(ExperimentalWasmJsInterop::class)

package com.tanyudii.tmuxweb.terminal

import com.tanyudii.tmuxweb.domain.copyResultMessage
import com.tanyudii.tmuxweb.domain.isCopyShortcut
import com.tanyudii.tmuxweb.domain.isFindShortcut
import kotlin.js.ExperimentalWasmJsInterop
import org.w3c.dom.HTMLDivElement
import org.w3c.dom.events.Event
import org.w3c.dom.events.KeyboardEvent

// Split out of PlatformTerminalView.wasmJs.kt purely to keep that file under
// the project's TooManyFunctions/LongMethod thresholds -- no behavior
// change. Everything here is about the terminal container's keydown
// wiring (copy/zoom/search shortcuts) plus the copy action they trigger.

internal const val DEFAULT_FONT_SIZE = 14
private const val MIN_FONT_SIZE = 8
private const val MAX_FONT_SIZE = 32
private const val COPY_TOAST_DURATION_MS = 1800

// Pure mapping, split out to keep the caller's cyclomatic complexity under
// the project's threshold -- no behavior change.
private fun nextZoomFontSize(key: String, currentSize: Int): Int? = when (key) {
    "=", "+" -> (currentSize + 1).coerceAtMost(MAX_FONT_SIZE)
    "-" -> (currentSize - 1).coerceAtLeast(MIN_FONT_SIZE)
    "0" -> DEFAULT_FONT_SIZE
    else -> null
}

// Cmd+C is the Mac copy shortcut, but xterm's own hidden input textarea can
// end up being what the browser's native copy command targets, so the
// selected terminal text doesn't reliably reach the clipboard. Handle it
// ourselves whenever there's an active selection -- same fix as the pre-KMP
// public/app.js (commit 73be7a0). Ctrl+C is left alone so it still sends
// SIGINT to the shell, matching every other terminal. Returns true if the
// event was claimed as a copy request, so the caller can skip zoom handling.
private fun handleCopyKeyDown(
    keyEvent: KeyboardEvent,
    terminal: XtermTerminal?,
    onCopyRequested: (XtermTerminal) -> Unit,
): Boolean {
    val isCopy = isCopyShortcut(
        type = keyEvent.type,
        metaKey = keyEvent.metaKey,
        shiftKey = keyEvent.shiftKey,
        key = keyEvent.key,
    )
    if (terminal == null || !isCopy || !terminal.hasSelection()) return false
    keyEvent.preventDefault()
    onCopyRequested(terminal)
    return true
}

// Ctrl/Cmd +/-/0 zoom, same convention as browsers and every desktop
// terminal emulator. Returns true once the keystroke was recognized as a
// zoom shortcut (even a no-op one, e.g. already at MAX_FONT_SIZE) so the
// caller knows not to fall through to any other handling.
private fun handleZoomKeyDown(
    keyEvent: KeyboardEvent,
    terminal: XtermTerminal?,
    fontSize: Int,
    onZoomChanged: (term: XtermTerminal, nextSize: Int) -> Unit,
): Boolean {
    val isZoomModifier = keyEvent.ctrlKey || keyEvent.metaKey
    val nextSize = if (isZoomModifier) nextZoomFontSize(keyEvent.key, fontSize) else null
    if (nextSize == null) return false
    // preventDefault() stops the browser's own page-zoom from also firing
    // on the same keystroke.
    keyEvent.preventDefault()
    if (nextSize != fontSize) terminal?.let { onZoomChanged(it, nextSize) }
    return true
}

// EMB-219: Ctrl+F/Cmd+F opens the terminal-local search bar instead of the
// browser's native find-in-page. Scoping to "only while the terminal has
// focus" needs no explicit activeElement check: this handler is wired into
// the SAME container-level `addEventListener("keydown", ...)` as
// handleCopyKeyDown/handleZoomKeyDown below, which only ever receives
// events that bubble up from inside `container` -- Ctrl+F pressed anywhere
// else on the page never reaches it, so the browser's own find-in-page
// still fires normally there (same scoping argument already proven for
// EMB-218's command-palette Ctrl+K, just via a JS DOM listener here instead
// of Compose's onPreviewKeyEvent).
// `searchAddon`/`terminal` are passed as accessors (not values) since
// they're read from `remember`ed Compose state that can change between when
// this closure is created (once, in `factory`) and when it actually runs
// (on a later keydown).
private fun openTerminalSearchBar(
    container: HTMLDivElement,
    searchAddon: () -> XtermSearchAddon?,
    terminal: () -> XtermTerminal?,
) {
    showSearchBar(
        container = container,
        onSearchInput = { term -> searchAddon()?.findNext(term) ?: false },
        onFindNext = { term -> searchAddon()?.findNext(term) ?: false },
        onFindPrevious = { term -> searchAddon()?.findPrevious(term) ?: false },
        onClose = {
            hideSearchBar(container)
            searchAddon()?.clearActiveDecoration()
            terminal()?.focus()
        },
    )
}

private fun handleSearchKeyDown(keyEvent: KeyboardEvent, onOpenSearch: () -> Unit): Boolean {
    val isFind = isFindShortcut(
        type = keyEvent.type,
        ctrlKey = keyEvent.ctrlKey,
        metaKey = keyEvent.metaKey,
        key = keyEvent.key,
    )
    if (!isFind) return false
    keyEvent.preventDefault()
    onOpenSearch()
    return true
}

// Registers the same two listeners (capture-phase search shortcut,
// bubble-phase copy/zoom) that used to be wired inline in
// PlatformTerminalView's `factory` block.
//
// EMB-219: the search shortcut is registered separately, in the CAPTURE
// phase (the trailing `true` below) -- confirmed live that xterm.js's own
// internal keydown handler (on its hidden textarea, the actual event
// *target*) treats Ctrl+F as the VT control character ^F and
// stopPropagation()s it before a bubble-phase listener on `container` would
// ever see it (Cmd+F worked fine, since metaKey isn't in xterm's
// Ctrl-letter VT keymap). A capture-phase listener on an ancestor is the
// only way to intercept ahead of xterm's own handling.
internal fun attachTerminalKeydownListeners(
    container: HTMLDivElement,
    terminal: () -> XtermTerminal?,
    searchAddon: () -> XtermSearchAddon?,
    fontSize: () -> Int,
    onZoomApplied: (current: XtermTerminal, nextSize: Int) -> Unit,
) {
    container.addEventListener(
        "keydown",
        { event: Event ->
            val keyEvent = event as KeyboardEvent
            if (handleSearchKeyDown(keyEvent) {
                    openTerminalSearchBar(container, searchAddon, terminal)
                }
            ) {
                keyEvent.stopPropagation()
            }
        },
        true,
    )
    container.addEventListener("keydown", { event: Event ->
        val keyEvent = event as KeyboardEvent
        val copied = handleCopyKeyDown(keyEvent, terminal()) { activeTerminal ->
            performCopy(activeTerminal, container)
        }
        if (copied) return@addEventListener
        handleZoomKeyDown(keyEvent, terminal(), fontSize(), onZoomApplied)
    })
}

// The copy feedback toast is a real DOM element appended to `container`,
// NOT a Compose composable -- Compose Multiplatform Web's canvas content
// can't paint over this HtmlElementView's native DOM (same CMP-8521
// limitation documented on PlatformTerminalView.isVisible/the
// container.parentElement visibility fix), so a Compose-rendered toast
// sitting in the same Box as this view would be permanently hidden
// underneath xterm's real DOM node. Confirmed live via Playwright: a first
// attempt using a Compose Box+Text overlay never appeared on screen despite
// the copy itself succeeding.
private fun performCopy(term: XtermTerminal, container: HTMLDivElement) {
    val text = term.getSelection().toString()
    copyTextToClipboard(text) { success ->
        val durationMs = if (success) COPY_TOAST_DURATION_MS else 0
        showCopyToast(container, copyResultMessage(success), success, durationMs)
        // execCommand's scratch textarea (see XtermJs.kt's copyTextToClipboard)
        // takes focus away from xterm's own hidden input; move it back so
        // keystrokes keep reaching the shell, win or lose.
        term.focus()
    }
}
