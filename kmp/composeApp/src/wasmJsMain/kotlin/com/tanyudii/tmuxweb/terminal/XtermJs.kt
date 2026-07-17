@file:OptIn(ExperimentalWasmJsInterop::class)

package com.tanyudii.tmuxweb.terminal

import kotlin.js.ExperimentalWasmJsInterop
import org.w3c.dom.HTMLElement

// External bindings against the globals that public/vendor/xterm.js + addon-fit.js
// attach to `globalThis` (UMD build, not an ES module — see Spike B notes in
// docs/adr/0002-web-terminal-embedding.md). No @JsModule/npm wiring needed because
// these are loaded as plain <script> tags, exactly like the existing public/app.js.
external class XtermTerminal : JsAny {
    val cols: Int
    val rows: Int

    fun open(container: HTMLElement)
    fun write(data: JsString)
    fun onData(callback: (JsString) -> Unit)
    fun onBell(callback: () -> Unit)
    fun resize(cols: Int, rows: Int)
    fun loadAddon(addon: XtermFitAddon)
    fun loadAddon(addon: XtermSearchAddon)
    fun dispose()
    fun focus()

    // Selection/clipboard surface -- xterm.js's SelectionService already
    // exists internally (vendor/xterm.js), these bindings just expose it to
    // Kotlin. See public/app.js's pre-KMP Cmd+C fix (commit 73be7a0) for the
    // proven usage: hasSelection() gates whether Cmd+C is ours to intercept,
    // getSelection() reads the text to hand to the clipboard-write chain.
    fun hasSelection(): Boolean
    fun getSelection(): JsString
    fun clearSelection()
}

external class XtermFitAddon : JsAny {
    fun fit()
}

// EMB-219: bindings for @xterm/addon-search@0.16.0 (vendor/addon-search.js),
// vendored the same way as addon-fit.js -- see index.html's script tags.
// findNext/findPrevious always select+scroll the match themselves (xterm's
// own SearchAddon source, confirmed reading its `_selectResult` -- it calls
// `_terminal.select(...)` unconditionally, not just when `decorations` is
// passed), so a found match is already visibly highlighted via xterm's
// normal selection styling with no extra decoration options needed here.
external class XtermSearchAddon : JsAny {
    fun findNext(term: String): Boolean
    fun findPrevious(term: String): Boolean
    fun clearActiveDecoration()
}

fun newSearchAddon(): XtermSearchAddon =
    js("new SearchAddon.SearchAddon()")

// Native browser API, not xterm-specific -- named to match the real global
// `ResizeObserver` exactly (unlike XtermTerminal/XtermFitAddon above, which
// deliberately do NOT match their library's real global names and need the
// window.XtermTerminal/window.XtermFitAddon aliases in index.html). Kotlin/
// Wasm's JS interop generates an `instanceof <name>` runtime check keyed off
// this exact external class name, so getting the name right here means no
// alias is needed for this one.
external class ResizeObserver : JsAny {
    fun observe(target: HTMLElement)
    fun disconnect()
}

// Same false-positive as setFontSize() above -- `callback` is used inside
// the raw js() string body.
@Suppress("UnusedParameter")
fun newResizeObserver(callback: () -> Unit): ResizeObserver =
    js("new ResizeObserver(callback)")

fun newFitAddon(): XtermFitAddon =
    js("new FitAddon.FitAddon()")

// fontSize pinned explicitly (matches DEFAULT_FONT_SIZE in
// PlatformTerminalView.wasmJs.kt) rather than left at xterm.js's own
// built-in default, so Ctrl+0 "reset zoom" has a known, exact value to
// reset to instead of guessing at whatever xterm.js ships as default.
// rightClickSelectsWord: false -- xterm.js defaults this to true on macOS,
// which replaces an existing multi-line selection with a single word on
// right-click. Same fix as public/app.js commit 73be7a0.
// macOptionClickForcesSelection: true -- tmux runs with `mouse on` (see
// src/tmux.ts), so a plain drag is captured by tmux's own mouse-reporting
// (which enters tmux's copy-mode and copies into tmux's *own* internal
// paste buffer -- the "copied N chars to tmux buffer" status message a
// user sees is tmux's, not this app's). xterm.js's own vendored source
// (vendor/xterm.js) forces local browser-side selection instead via
// `isMac ? e.altKey && macOptionClickForcesSelection : e.shiftKey` -- i.e.
// Shift+drag already worked on Windows/Linux without this option, but on
// macOS the bypass modifier is Option/Alt, and it does nothing at all
// unless this option is explicitly enabled (it's not part of xterm.js's
// own defaults). Without it, every Mac user's drag falls through to tmux
// every time, and hasSelection() (XtermTerminal) is always false, so
// Cmd+C in PlatformTerminalView.wasmJs.kt never has anything to copy.
fun newTerminal(): XtermTerminal =
    js(
        "new Terminal({ cursorBlink: true, fontFamily: 'monospace', fontSize: 14, bellStyle: 'none'," +
            " rightClickSelectsWord: false, macOptionClickForcesSelection: true })",
    )

// navigator.clipboard.writeText needs a secure context (HTTPS/localhost),
// which this app's README steers deployments away from (plain-HTTP
// WireGuard/Tailscale tunnel). Falls back to the legacy execCommand path for
// those deployments, same two-tier chain proven in public/app.js commit
// 73be7a0/4d5e4e0. onResult reports success/failure back to Kotlin so the
// caller can drive toast feedback.
@Suppress("UnusedParameter")
fun copyTextToClipboard(text: String, onResult: (Boolean) -> Unit): Unit = js(
    """{
        function fallback() {
            var scratch = document.createElement('textarea');
            scratch.value = text;
            scratch.style.position = 'fixed';
            scratch.style.opacity = '0';
            document.body.appendChild(scratch);
            scratch.select();
            var copied = false;
            try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
            scratch.remove();
            onResult(copied);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { onResult(true); }, fallback);
        } else {
            fallback();
        }
    }""",
)

// A real DOM toast appended to `container`, not a Compose composable --
// Compose Multiplatform Web's canvas can't paint over this HtmlElementView's
// native DOM, so a Compose overlay in the same Box would render invisibly
// underneath it (confirmed live via Playwright). durationMs <= 0 leaves the
// toast up indefinitely (used for copy failures, which stay until the user
// copies again or the container unmounts).
@Suppress("UnusedParameter")
fun showCopyToast(container: HTMLElement, message: String, success: Boolean, durationMs: Int): Unit = js(
    """{
        var toast = container.querySelector('.tmux-copy-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'tmux-copy-toast';
            toast.style.position = 'absolute';
            toast.style.right = '16px';
            toast.style.bottom = '16px';
            toast.style.padding = '6px 12px';
            toast.style.borderRadius = '8px';
            toast.style.background = '#1B212C';
            toast.style.color = '#E6E9EF';
            toast.style.fontSize = '13px';
            toast.style.fontFamily = 'sans-serif';
            toast.style.zIndex = '10';
            toast.style.pointerEvents = 'none';
            container.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.border = '1px solid ' + (success ? '#3ECF8E' : '#F4685F');
        toast.style.display = 'block';
        if (toast._tmuxHideTimer) clearTimeout(toast._tmuxHideTimer);
        if (durationMs > 0) {
            toast._tmuxHideTimer = setTimeout(function () { toast.style.display = 'none'; }, durationMs);
        }
    }""",
)

// Hides and clears any pending auto-dismiss timer on the copy toast, if one
// exists. Called whenever the container is hidden behind a Popup/Dialog
// (isVisible = false, see updateTerminalContainer) so a stale failure
// message (which has no auto-dismiss timer -- it stays up until the user
// copies again) doesn't silently resurface when the dialog closes and the
// terminal becomes visible again, falsely implying a copy just failed.
@Suppress("UnusedParameter")
fun hideCopyToast(container: HTMLElement): Unit = js(
    """{
        var toast = container.querySelector('.tmux-copy-toast');
        if (!toast) return;
        if (toast._tmuxHideTimer) clearTimeout(toast._tmuxHideTimer);
        toast.style.display = 'none';
    }""",
)

// EMB-219: search bar overlay, built the exact same way as
// showCopyToast/hideCopyToast above -- a real DOM element appended to
// `container`, NOT a Compose composable. Same CMP-8521 reasoning as the
// copy toast: Compose Multiplatform Web's canvas can never paint over this
// HtmlElementView's native DOM, so a Compose overlay would render invisibly
// underneath xterm's real DOM node.
//
// Reopening while already open (container.querySelector finds an existing
// bar) just re-shows and refocuses/reselects it rather than rebuilding --
// so pressing Ctrl+F again with the bar already open is a no-op that jumps
// focus back to the search field instead of stacking a second bar.
//
// onSearchInput/onFindNext/onFindPrevious each read `input.value` directly
// in their own JS event-handler closure rather than Kotlin tracking "the
// current search term" separately -- one source of truth, no risk of it
// drifting out of sync with what's actually typed. Each returns whether a
// match was found so the input's border can give immediate not-found
// feedback, same spirit as a browser's native find bar.
//
// Search only ever covers xterm's own JS-side buffer, which -- confirmed
// live via Playwright for EMB-219 -- only ever holds the currently-rendered
// screen for this app: tmux repaints panes via ANSI cursor positioning
// rather than emitting real newlines (see tmux.ts's `scrollPane` doc
// comment), so xterm never accumulates genuine scrollback rows to search
// beyond what's on screen right now, regardless of its configured
// scrollback capacity. The input's placeholder/title says so rather than
// silently implying full-history search.
//
// LongMethod suppressed: this is a raw JS DOM-construction string, not
// Kotlin control flow -- splitting it across multiple js() calls would
// fragment one cohesive DOM-building/event-wiring block for no readability
// gain (same reasoning as the other js()-bodied functions in this file).
@Suppress("UnusedParameter", "LongMethod")
fun showSearchBar(
    container: HTMLElement,
    onSearchInput: (String) -> Boolean,
    onFindNext: (String) -> Boolean,
    onFindPrevious: (String) -> Boolean,
    onClose: () -> Unit,
): Unit = js(
    """{
        var bar = container.querySelector('.tmux-search-bar');
        if (bar) {
            bar.style.display = 'flex';
            var existingInput = bar.querySelector('input');
            existingInput.focus();
            existingInput.select();
            return;
        }
        bar = document.createElement('div');
        bar.className = 'tmux-search-bar';
        bar.style.position = 'absolute';
        bar.style.top = '8px';
        bar.style.right = '16px';
        bar.style.display = 'flex';
        bar.style.alignItems = 'center';
        bar.style.gap = '4px';
        bar.style.padding = '4px 6px';
        bar.style.borderRadius = '8px';
        bar.style.background = '#1B212C';
        bar.style.border = '1px solid #2A3140';
        bar.style.zIndex = '20';
        bar.style.fontFamily = 'sans-serif';

        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Find on screen';
        input.title = 'Searches only the currently visible screen, not scrollback history';
        input.style.background = 'transparent';
        input.style.border = '1px solid transparent';
        input.style.borderRadius = '4px';
        input.style.outline = 'none';
        input.style.color = '#E6E9EF';
        input.style.fontSize = '13px';
        input.style.fontFamily = 'inherit';
        input.style.width = '160px';
        input.style.padding = '2px 4px';

        function markFound(found) {
            input.style.borderColor = (input.value && !found) ? '#F4685F' : 'transparent';
        }

        function makeButton(label, title) {
            var button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.title = title;
            button.style.background = 'transparent';
            button.style.border = 'none';
            button.style.color = '#9AA4B2';
            button.style.cursor = 'pointer';
            button.style.fontSize = '13px';
            button.style.padding = '2px 4px';
            return button;
        }

        var prevButton = makeButton('↑', 'Previous match (Shift+Enter)');
        var nextButton = makeButton('↓', 'Next match (Enter)');
        var closeButton = makeButton('✕', 'Close (Esc)');

        input.addEventListener('input', function () {
            markFound(onSearchInput(input.value));
        });
        input.addEventListener('keydown', function (keyEvent) {
            if (keyEvent.key === 'Enter') {
                keyEvent.preventDefault();
                markFound(keyEvent.shiftKey ? onFindPrevious(input.value) : onFindNext(input.value));
            } else if (keyEvent.key === 'Escape') {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                onClose();
            }
        });
        prevButton.addEventListener('click', function () { markFound(onFindPrevious(input.value)); });
        nextButton.addEventListener('click', function () { markFound(onFindNext(input.value)); });
        closeButton.addEventListener('click', function () { onClose(); });

        bar.appendChild(input);
        bar.appendChild(prevButton);
        bar.appendChild(nextButton);
        bar.appendChild(closeButton);
        container.appendChild(bar);
        input.focus();
    }""",
)

/** Hides the search bar (see [showSearchBar]) without destroying it, so reopening restores its last search term. */
@Suppress("UnusedParameter")
fun hideSearchBar(container: HTMLElement): Unit = js(
    """{
        var bar = container.querySelector('.tmux-search-bar');
        if (bar) bar.style.display = 'none';
    }""",
)

// xterm.js exposes font size as a mutable property on `.options`, not a
// method -- there's nothing to bind as an `external class` member for it,
// so this is a small JS shim in the same style as newFitAddon()/newTerminal().
// Detekt can't see that `js()`'s raw JS string body references these
// parameters by name -- both are genuinely used, this is a false positive.
@Suppress("UnusedParameter")
fun setFontSize(terminal: XtermTerminal, size: Int): Unit =
    js("terminal.options.fontSize = size")
