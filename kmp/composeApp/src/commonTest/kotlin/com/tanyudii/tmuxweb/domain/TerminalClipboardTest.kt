package com.tanyudii.tmuxweb.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Ports public/terminal-clipboard.test.js's cases 1:1 for isCopyShortcut/copyResultMessage. */
class TerminalClipboardTest {
    @Test
    fun `recognizes Cmd+C on keydown`() {
        val result = isCopyShortcut(type = "keydown", metaKey = true, ctrlKey = false, shiftKey = false, key = "c")

        assertTrue(result)
    }

    @Test
    fun `is case-insensitive on the key value`() {
        val result = isCopyShortcut(type = "keydown", metaKey = true, ctrlKey = false, shiftKey = false, key = "C")

        assertTrue(result)
    }

    @Test
    fun `ignores keyup so the copy doesn't fire twice per press`() {
        val result = isCopyShortcut(type = "keyup", metaKey = true, ctrlKey = false, shiftKey = false, key = "c")

        assertFalse(result)
    }

    @Test
    fun `recognizes plain Ctrl+C as a copy attempt, same convention as coolify's terminal`() {
        val result = isCopyShortcut(type = "keydown", metaKey = false, ctrlKey = true, shiftKey = false, key = "c")

        assertTrue(result)
    }

    @Test
    fun `ignores unrelated Cmd shortcuts`() {
        val result = isCopyShortcut(type = "keydown", metaKey = true, ctrlKey = false, shiftKey = false, key = "v")

        assertFalse(result)
    }

    @Test
    fun `ignores Cmd+Shift+C so it doesn't collide with the macOS devtools inspector shortcut`() {
        val result = isCopyShortcut(type = "keydown", metaKey = true, ctrlKey = false, shiftKey = true, key = "C")

        assertFalse(result)
    }

    @Test
    fun `ignores Ctrl+Shift+C so it doesn't collide with the Windows Linux devtools inspector shortcut`() {
        val result = isCopyShortcut(type = "keydown", metaKey = false, ctrlKey = true, shiftKey = true, key = "C")

        assertFalse(result)
    }

    @Test
    fun `success message confirms the copy`() {
        assertEquals("Copied", copyResultMessage(success = true))
    }

    @Test
    fun `failure message tells the user to copy manually`() {
        assertEquals("Auto-copy failed — select the text and copy manually", copyResultMessage(success = false))
    }

    @Test
    fun `no-selection message tells the user how to select terminal text`() {
        assertEquals(
            "No text selected — hold Option (Mac) or Shift (Windows/Linux) while dragging, then copy again",
            COPY_NO_SELECTION_MESSAGE,
        )
    }
}
