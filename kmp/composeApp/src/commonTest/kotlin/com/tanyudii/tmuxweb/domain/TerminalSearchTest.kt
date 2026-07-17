package com.tanyudii.tmuxweb.domain

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TerminalSearchTest {
    @Test
    fun `recognizes Ctrl+F on keydown`() {
        val result = isFindShortcut(type = "keydown", ctrlKey = true, metaKey = false, key = "f")

        assertTrue(result)
    }

    @Test
    fun `recognizes Cmd+F on keydown`() {
        val result = isFindShortcut(type = "keydown", ctrlKey = false, metaKey = true, key = "f")

        assertTrue(result)
    }

    @Test
    fun `is case-insensitive on the key value`() {
        val result = isFindShortcut(type = "keydown", ctrlKey = true, metaKey = false, key = "F")

        assertTrue(result)
    }

    @Test
    fun `ignores keyup so search doesn't retrigger per press`() {
        val result = isFindShortcut(type = "keyup", ctrlKey = true, metaKey = false, key = "f")

        assertFalse(result)
    }

    @Test
    fun `ignores plain f with no modifier so typing still reaches the shell`() {
        val result = isFindShortcut(type = "keydown", ctrlKey = false, metaKey = false, key = "f")

        assertFalse(result)
    }

    @Test
    fun `ignores unrelated Ctrl shortcuts`() {
        val result = isFindShortcut(type = "keydown", ctrlKey = true, metaKey = false, key = "c")

        assertFalse(result)
    }
}
