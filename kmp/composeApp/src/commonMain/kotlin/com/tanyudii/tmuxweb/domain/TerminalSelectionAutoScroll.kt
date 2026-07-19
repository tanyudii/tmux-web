package com.tanyudii.tmuxweb.domain

private const val DEFAULT_MAX_LINES_PER_TICK = 15

/**
 * How many lines (and in which direction) an Option-forced selection drag
 * needs to auto-scroll for the current pointer position, so dragging past
 * the top/bottom edge of the terminal viewport keeps revealing more content.
 *
 * xterm.js's own vendored SelectionService already does edge-based auto-scroll
 * during a drag (see its `_getMouseEventScrollAmount`/`_dragScroll`), but it
 * scrolls xterm's own LOCAL scrollback buffer -- which stays effectively
 * empty in this app, since tmux repaints the pane via cursor addressing
 * rather than feeding real scrollback into xterm locally (same root cause as
 * TerminalTouchScroll.wasmJs.kt's touch-drag fix). This function instead
 * drives the same tmux-side scroll request already used for touch drags
 * (PlatformTerminalView's onScroll -> TerminalViewModel.onScroll), so it
 * needs its own edge-distance math rather than reusing xterm's internal one.
 *
 * Returns 0 while [pointerY] is within the viewport (`0..viewportHeight`
 * inclusive). Past an edge, the scroll speed grows linearly with how far
 * past the edge the pointer is, capped at [maxLinesPerTick] so a large
 * overshoot (e.g. the pointer released far outside the window) can't
 * teleport the pane instead of scrolling it. Negative results mean scroll up
 * into history, positive means scroll down toward the present -- the same
 * sign convention as [accumulateScrollLines].
 *
 * Returns 0 when [pixelsPerLine] is not positive -- the terminal hasn't been
 * laid out/fitted yet, so there's no meaningful pixels-per-line ratio to
 * divide by.
 */
fun dragEdgeScrollLines(
    pointerY: Double,
    viewportHeight: Double,
    pixelsPerLine: Double,
    maxLinesPerTick: Int = DEFAULT_MAX_LINES_PER_TICK,
): Int {
    if (pixelsPerLine <= 0.0) return 0
    val overshootPx = when {
        pointerY < 0.0 -> pointerY
        pointerY > viewportHeight -> pointerY - viewportHeight
        else -> return 0
    }
    val lines = (overshootPx / pixelsPerLine).toInt()
    return lines.coerceIn(-maxLinesPerTick, maxLinesPerTick)
}
