@file:OptIn(ExperimentalWasmJsInterop::class)

package com.tanyudii.tmuxweb.terminal

import kotlin.js.ExperimentalWasmJsInterop
import org.w3c.dom.HTMLElement

// Split out of PlatformTerminalView.wasmJs.kt for the same reason
// TerminalTouchScroll.wasmJs.kt was split out of XtermJs.kt -- keeps that
// file under detekt's TooManyFunctions threshold, no behavior change.
//
// Turns an Option-forced selection drag near the terminal's top/bottom edge
// into a repeating [onTick] callback carrying the current pointer Y
// (relative to `container`) and the container's height, at the same ~50ms
// cadence as xterm.js's own vendored SelectionService's
// `_dragScrollIntervalTimer`. See `dragEdgeScrollLines`
// (domain/TerminalSelectionAutoScroll.kt) for why xterm's own built-in
// edge-auto-scroll can't be reused directly here: it drives xterm's local
// scrollback buffer, which stays effectively empty in this app (same root
// cause TerminalTouchScroll.wasmJs.kt already documents for touch-drag
// scrolling) since tmux repaints the pane via cursor addressing instead of
// feeding real scrollback into xterm locally.
//
// Only mousedown events with `altKey` are tracked -- `macOptionClickForcesSelection`
// (XtermJs.kt's newTerminal()) is what forces xterm's local selection in the
// first place, and it's Mac-only and altKey-gated. A plain drag (no Option)
// is tmux's own mouse-reporting, which already has its own native copy-mode
// auto-scroll untouched by this.
//
// Listeners live on `document` (like xterm's own SelectionService), not just
// `container`, so the drag is still tracked once the pointer moves outside
// the terminal's own bounds -- exactly the case this exists to handle.
@Suppress("UnusedParameter")
fun attachSelectionAutoScroll(
    container: HTMLElement,
    onTick: (pointerY: Double, containerHeight: Double) -> Unit,
): Unit = js(
    """{
        var timer = null;
        var lastY = null;
        function stop() {
            if (timer !== null) { clearInterval(timer); timer = null; }
            lastY = null;
        }
        function track(e) {
            lastY = e.clientY - container.getBoundingClientRect().top;
        }
        container.ownerDocument.addEventListener('mousedown', function (e) {
            if (!e.altKey || e.button !== 0) return;
            track(e);
            stop();
            timer = setInterval(function () {
                if (lastY !== null) onTick(lastY, container.clientHeight);
            }, 50);
        });
        container.ownerDocument.addEventListener('mousemove', function (e) {
            if (timer !== null) track(e);
        });
        container.ownerDocument.addEventListener('mouseup', stop);
    }""",
)
