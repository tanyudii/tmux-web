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

fun newFitAddon(): XtermFitAddon =
    js("new FitAddon.FitAddon()")

fun newTerminal(): XtermTerminal =
    js("new Terminal({ cursorBlink: true, fontFamily: 'monospace', bellStyle: 'none' })")
