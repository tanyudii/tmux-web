@file:OptIn(ExperimentalWasmJsInterop::class)

package com.tanyudii.tmuxweb.terminal

import kotlin.js.ExperimentalWasmJsInterop
import org.w3c.dom.HTMLElement

// Split out of XtermJs.kt purely to keep that file under the project's
// detekt TooManyFunctions threshold -- no behavior change.
//
// xterm.js does have its own touchstart/touchmove handlers, but they scroll its
// LOCAL scrollback buffer -- which is the wrong buffer here. tmux runs with
// `mouse on` (src/tmux.ts) and repaints its pane by cursor addressing, so the
// real scrollback lives in tmux, not in xterm, and xterm's local buffer stays
// effectively empty. Dragging therefore scrolls nothing at all. The fix is to
// report the gesture to tmux's own copy-mode instead (PlatformTerminalView's
// onScroll -> TerminalViewModel.onScroll), exactly like the iOS actual already
// does; this is only the DOM half of that.
//
// Written as a js() shim rather than Kotlin addEventListener calls because
// TouchEvent/TouchList aren't part of Kotlin/Wasm's org.w3c.dom surface, and
// because the listener options below matter: touchmove must be non-passive for
// preventDefault() to be allowed to stop iOS's rubber-band overscroll from
// hijacking the drag. touchstart stays passive -- it's only read, never
// cancelled, so a tap still reaches xterm and still focuses the terminal.
//
// Multi-touch is ignored outright (pinch-zoom is not ours to interpret).
@Suppress("UnusedParameter")
fun attachTouchScroll(container: HTMLElement, onStart: () -> Unit, onDrag: (Double) -> Unit): Unit = js(
    """{
        var lastY = 0;
        container.addEventListener('touchstart', function (e) {
            if (e.touches.length !== 1) return;
            lastY = e.touches[0].clientY;
            onStart();
        }, { passive: true });
        container.addEventListener('touchmove', function (e) {
            if (e.touches.length !== 1) return;
            var y = e.touches[0].clientY;
            var delta = y - lastY;
            lastY = y;
            if (delta !== 0) onDrag(delta);
            e.preventDefault();
        }, { passive: false });
    }""",
)
