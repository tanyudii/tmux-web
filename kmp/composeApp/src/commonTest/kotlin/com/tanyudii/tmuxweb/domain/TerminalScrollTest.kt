package com.tanyudii.tmuxweb.domain

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TerminalScrollTest {

    @Test
    fun `reports no lines and keeps the carry when the terminal has no laid-out height yet`() {
        // Arrange: pixelsPerLine <= 0 is the "not fitted yet" case.
        val carry = 0.4

        // Act
        val result = accumulateScrollLines(deltaPx = 100.0, pixelsPerLine = 0.0, carry = carry)

        // Assert
        assertEquals(0, result.lines)
        assertEquals(carry, result.carry)
    }

    @Test
    fun `reports no lines for a drag shorter than a single line`() {
        // Arrange / Act: 7px of an 18px line.
        val result = accumulateScrollLines(deltaPx = 7.0, pixelsPerLine = 18.0, carry = 0.0)

        // Assert
        assertEquals(0, result.lines)
        assertTrue(result.carry > 0.0, "the sub-line remainder must survive for the next call")
    }

    @Test
    fun `accumulates successive sub-line drags until they cross a line boundary`() {
        // Arrange: three 7px steps over an 18px line = 21px, i.e. one whole line.
        var carry = 0.0
        val reported = mutableListOf<Int>()

        // Act
        repeat(3) {
            val result = accumulateScrollLines(deltaPx = 7.0, pixelsPerLine = 18.0, carry = carry)
            carry = result.carry
            if (result.lines != 0) reported += result.lines
        }

        // Assert: a slow drag must eventually scroll, not silently do nothing.
        assertEquals(listOf(1), reported)
    }

    @Test
    fun `a positive delta scrolls down and a negative delta scrolls up`() {
        // Arrange / Act
        val down = accumulateScrollLines(deltaPx = 36.0, pixelsPerLine = 18.0, carry = 0.0)
        val up = accumulateScrollLines(deltaPx = -36.0, pixelsPerLine = 18.0, carry = 0.0)

        // Assert
        assertEquals(2, down.lines)
        assertEquals(-2, up.lines)
    }

    @Test
    fun `subtracts only the reported whole lines so the leftover fraction is not lost`() {
        // Arrange / Act: 45px over an 18px line = 2.5 lines.
        val result = accumulateScrollLines(deltaPx = 45.0, pixelsPerLine = 18.0, carry = 0.0)

        // Assert: 2 lines reported, half a line carried -- not reset to zero.
        assertEquals(2, result.lines)
        assertTrue(abs(result.carry - 0.5) < 1e-9, "expected a 0.5 line carry, got ${result.carry}")
    }

    @Test
    fun `does not drift over a long continuous drag`() {
        // Arrange: 100 steps of exactly one line each.
        var carry = 0.0
        var total = 0

        // Act
        repeat(100) {
            val result = accumulateScrollLines(deltaPx = 18.0, pixelsPerLine = 18.0, carry = carry)
            carry = result.carry
            total += result.lines
        }

        // Assert: 100 lines of gesture must report exactly 100 lines of scroll.
        assertEquals(100, total)
    }
}
