@file:OptIn(ExperimentalWasmJsInterop::class)

package com.tanyudii.tmuxweb.terminal

import kotlin.js.ExperimentalWasmJsInterop
import org.w3c.dom.HTMLElement

// Split out of PlatformTerminalView.wasmJs.kt for the same reason
// TerminalTouchScroll.wasmJs.kt was split out of XtermJs.kt.
//
// Detects "an Option-held drag just finished over the terminal" so the
// caller can relay tmux's own resulting copy-mode paste buffer to the real
// OS clipboard on the next Cmd+C -- see XtermJs.kt's newTerminal() comment
// for why this app no longer forces a local xterm selection for this, and
// TerminalKeydownHandlers.wasmJs.kt for the Cmd+C side.
//
// A small movement threshold (4px) distinguishes an actual drag-selection
// from an Option-click with no movement, which tmux's default mouse
// bindings don't copy anything for -- without this, [onDragEnded] would
// fire on every such click and relay whatever stale text happened to
// already be in tmux's paste buffer (from an earlier, unrelated copy) as if
// it were freshly selected.
private const val DRAG_THRESHOLD_PX = 4

@Suppress("UnusedParameter")
fun attachOptionDragCaptureListener(container: HTMLElement, onDragEnded: () -> Unit): Unit = js(
    """{
        var thresholdSq = $DRAG_THRESHOLD_PX * $DRAG_THRESHOLD_PX;
        container.ownerDocument.addEventListener('mousedown', function (e) {
            if (!e.altKey || e.button !== 0) return;
            var startX = e.clientX;
            var startY = e.clientY;
            function onUp(upEvent) {
                container.ownerDocument.removeEventListener('mouseup', onUp);
                var dx = upEvent.clientX - startX;
                var dy = upEvent.clientY - startY;
                if ((dx * dx + dy * dy) >= thresholdSq) onDragEnded();
            }
            container.ownerDocument.addEventListener('mouseup', onUp);
        });
    }""",
)
