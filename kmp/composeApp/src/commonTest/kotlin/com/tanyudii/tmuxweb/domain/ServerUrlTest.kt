package com.tanyudii.tmuxweb.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Ports ConnectionSettingsView.swift's `url.scheme != nil && url.host != nil` validation. */
class ServerUrlTest {
    @Test
    fun `accepts http URL with host and port`() {
        assertEquals("http://192.168.1.5:5309", parseServerUrl("http://192.168.1.5:5309"))
    }

    @Test
    fun `accepts https URL`() {
        assertEquals("https://tmux.example.com", parseServerUrl("https://tmux.example.com"))
    }

    @Test
    fun `trims surrounding whitespace`() {
        assertEquals("http://host:5309", parseServerUrl("  http://host:5309  "))
    }

    @Test
    fun `drops a path suffix`() {
        assertEquals("http://host:5309", parseServerUrl("http://host:5309/some/path"))
    }

    @Test
    fun `rejects a scheme-less string`() {
        assertNull(parseServerUrl("host:5309"))
    }

    @Test
    fun `rejects a scheme with no host`() {
        assertNull(parseServerUrl("http://"))
    }

    @Test
    fun `rejects a non-http scheme`() {
        assertNull(parseServerUrl("ftp://host"))
    }

    @Test
    fun `rejects blank input`() {
        assertNull(parseServerUrl(""))
    }
}
