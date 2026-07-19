package com.tanyudii.tmuxweb.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TerminalSelectionAutoScrollTest {

    @Test
    fun `reports no lines while the pointer stays inside the viewport`() {
        // Arrange / Act
        val result = dragEdgeScrollLines(pointerY = 50.0, viewportHeight = 200.0, pixelsPerLine = 18.0)

        // Assert
        assertEquals(0, result)
    }

    @Test
    fun `reports no lines exactly at the top edge`() {
        // Arrange / Act: boundary, not yet past the edge.
        val result = dragEdgeScrollLines(pointerY = 0.0, viewportHeight = 200.0, pixelsPerLine = 18.0)

        // Assert
        assertEquals(0, result)
    }

    @Test
    fun `reports no lines exactly at the bottom edge`() {
        // Arrange / Act: boundary, not yet past the edge.
        val result = dragEdgeScrollLines(pointerY = 200.0, viewportHeight = 200.0, pixelsPerLine = 18.0)

        // Assert
        assertEquals(0, result)
    }

    @Test
    fun `scrolls up into history when the pointer is above the top edge`() {
        // Arrange / Act: 36px above the top edge, 18px lines -- two lines' worth.
        val result = dragEdgeScrollLines(pointerY = -36.0, viewportHeight = 200.0, pixelsPerLine = 18.0)

        // Assert: negative == up/into history, matching accumulateScrollLines' convention.
        assertEquals(-2, result)
    }

    @Test
    fun `scrolls down toward the present when the pointer is below the bottom edge`() {
        // Arrange / Act: 36px below the bottom edge, 18px lines -- two lines' worth.
        val result = dragEdgeScrollLines(pointerY = 236.0, viewportHeight = 200.0, pixelsPerLine = 18.0)

        // Assert
        assertEquals(2, result)
    }

    @Test
    fun `caps the scroll speed at maxLinesPerTick even far past the edge`() {
        // Arrange / Act: 10000px past the bottom edge would be thousands of lines
        // uncapped -- a single drag past the edge must not teleport the pane.
        val result = dragEdgeScrollLines(
            pointerY = 10_200.0,
            viewportHeight = 200.0,
            pixelsPerLine = 18.0,
            maxLinesPerTick = 15,
        )

        // Assert
        assertEquals(15, result)
    }

    @Test
    fun `caps the scroll speed in the upward direction too`() {
        // Arrange / Act
        val result = dragEdgeScrollLines(
            pointerY = -10_000.0,
            viewportHeight = 200.0,
            pixelsPerLine = 18.0,
            maxLinesPerTick = 15,
        )

        // Assert
        assertEquals(-15, result)
    }

    @Test
    fun `scroll speed grows with distance past the edge`() {
        // Arrange / Act
        val near = dragEdgeScrollLines(pointerY = 210.0, viewportHeight = 200.0, pixelsPerLine = 18.0)
        val far = dragEdgeScrollLines(pointerY = 300.0, viewportHeight = 200.0, pixelsPerLine = 18.0)

        // Assert: further past the edge must scroll at least as fast, never slower.
        assertTrue(far >= near, "expected farther overshoot ($far) to scroll at least as fast as ($near)")
    }

    @Test
    fun `reports no lines when pixelsPerLine is not positive`() {
        // Arrange: the terminal hasn't been laid out/fitted yet.
        val result = dragEdgeScrollLines(pointerY = -500.0, viewportHeight = 200.0, pixelsPerLine = 0.0)

        // Assert
        assertEquals(0, result)
    }
}
