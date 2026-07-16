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
fun newTerminal(): XtermTerminal =
    js(
        "new Terminal({ cursorBlink: true, fontFamily: 'monospace', fontSize: 14, bellStyle: 'none'," +
            " rightClickSelectsWord: false })",
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

// xterm.js exposes font size as a mutable property on `.options`, not a
// method -- there's nothing to bind as an `external class` member for it,
// so this is a small JS shim in the same style as newFitAddon()/newTerminal().
// Detekt can't see that `js()`'s raw JS string body references these
// parameters by name -- both are genuinely used, this is a false positive.
@Suppress("UnusedParameter")
fun setFontSize(terminal: XtermTerminal, size: Int): Unit =
    js("terminal.options.fontSize = size")
