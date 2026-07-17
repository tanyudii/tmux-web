package com.tanyudii.tmuxweb.domain

/**
 * The outcome of folding one drag delta into a running scroll accumulator:
 * [lines] whole lines to report now (negative = up/into history, positive =
 * down/back toward the present, 0 = nothing to report yet), and [carry], the
 * sub-line remainder to feed back into the next call.
 */
data class ScrollAccumulation(val lines: Int, val carry: Double)

/**
 * Folds a pixel drag delta into whole terminal lines, carrying the sub-line
 * remainder across calls.
 *
 * A drag reports in pixels, but tmux's copy-mode scrollback only moves in whole
 * lines, and a single touchmove is usually a fraction of one line. Dropping that
 * fraction would make a slow drag report nothing at all, so the remainder is
 * returned as [ScrollAccumulation.carry] for the caller to pass back in — the
 * fractions add up until they cross a line boundary.
 *
 * [deltaPx] follows the "positive = scroll down" sign convention (callers negate
 * a raw finger delta, since dragging *down* means scrolling *up* into history).
 * Truncation toward zero, and subtracting whole lines from the accumulator
 * rather than resetting it, both mirror SwiftTermViewFactory.swift's
 * `reportScroll` so the two platforms scroll at the same rate for the same
 * gesture.
 *
 * Returns 0 lines (carry unchanged) when [pixelsPerLine] is not positive — that
 * means the terminal hasn't been laid out/fitted yet, so there is no meaningful
 * pixels-per-line ratio to divide by.
 */
fun accumulateScrollLines(deltaPx: Double, pixelsPerLine: Double, carry: Double): ScrollAccumulation {
    if (pixelsPerLine <= 0.0 || deltaPx == 0.0) return ScrollAccumulation(0, carry)
    val total = carry + deltaPx / pixelsPerLine
    val lines = total.toInt()
    return ScrollAccumulation(lines, total - lines)
}
