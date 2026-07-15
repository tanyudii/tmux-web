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
fun newTerminal(): XtermTerminal =
    js("new Terminal({ cursorBlink: true, fontFamily: 'monospace', fontSize: 14, bellStyle: 'none' })")

// xterm.js exposes font size as a mutable property on `.options`, not a
// method -- there's nothing to bind as an `external class` member for it,
// so this is a small JS shim in the same style as newFitAddon()/newTerminal().
// Detekt can't see that `js()`'s raw JS string body references these
// parameters by name -- both are genuinely used, this is a false positive.
@Suppress("UnusedParameter")
fun setFontSize(terminal: XtermTerminal, size: Int): Unit =
    js("terminal.options.fontSize = size")
