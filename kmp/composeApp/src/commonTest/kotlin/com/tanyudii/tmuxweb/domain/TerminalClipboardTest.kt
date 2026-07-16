package com.tanyudii.tmuxweb.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Ports public/terminal-clipboard.test.js's cases 1:1 for isCopyShortcut/copyResultMessage. */
class TerminalClipboardTest {
    @Test
    fun `recognizes Cmd+C on keydown`() {
        val result = isCopyShortcut(type = "keydown", metaKey = true, shiftKey = false, key = "c")

        assertTrue(result)
    }

    @Test
    fun `is case-insensitive on the key value`() {
        val result = isCopyShortcut(type = "keydown", metaKey = true, shiftKey = false, key = "C")

        assertTrue(result)
    }

    @Test
    fun `ignores keyup so the copy doesn't fire twice per press`() {
        val result = isCopyShortcut(type = "keyup", metaKey = true, shiftKey = false, key = "c")

        assertFalse(result)
    }

    @Test
    fun `leaves Ctrl+C alone so it still sends SIGINT to the shell`() {
        val result = isCopyShortcut(type = "keydown", metaKey = false, shiftKey = false, key = "c")

        assertFalse(result)
    }

    @Test
    fun `ignores unrelated Cmd shortcuts`() {
        val result = isCopyShortcut(type = "keydown", metaKey = true, shiftKey = false, key = "v")

        assertFalse(result)
    }

    @Test
    fun `ignores Cmd+Shift+C so it doesn't collide with the browser devtools inspector shortcut`() {
        val result = isCopyShortcut(type = "keydown", metaKey = true, shiftKey = true, key = "C")

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
}
