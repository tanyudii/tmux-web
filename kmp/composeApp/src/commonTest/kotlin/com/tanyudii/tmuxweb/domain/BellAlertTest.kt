package com.tanyudii.tmuxweb.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Ports public/notify.test.js's cases 1:1 for shouldPlayBellAlert/buildBellTitle. */
class BellAlertTest {
    @Test
    fun `muted never alerts even while away`() {
        val result = shouldPlayBellAlert(muted = true, hasFocus = false, hidden = true, lastAlertAt = null, now = 1000L)

        assertFalse(result)
    }

    @Test
    fun `focused and visible does not alert`() {
        val result =
            shouldPlayBellAlert(muted = false, hasFocus = true, hidden = false, lastAlertAt = null, now = 1000L)

        assertFalse(result)
    }

    @Test
    fun `hidden tab alerts on first bell`() {
        val result =
            shouldPlayBellAlert(muted = false, hasFocus = true, hidden = true, lastAlertAt = null, now = 1000L)

        assertTrue(result)
    }

    @Test
    fun `unfocused but visible window alerts on first bell`() {
        val result =
            shouldPlayBellAlert(muted = false, hasFocus = false, hidden = false, lastAlertAt = null, now = 1000L)

        assertTrue(result)
    }

    @Test
    fun `second bell within cooldown is suppressed`() {
        val result = shouldPlayBellAlert(
            muted = false,
            hasFocus = false,
            hidden = true,
            lastAlertAt = 1000L,
            now = 1000L + BELL_COOLDOWN_MS - 1,
        )

        assertFalse(result)
    }

    @Test
    fun `bell after cooldown elapses alerts again`() {
        val result = shouldPlayBellAlert(
            muted = false,
            hasFocus = false,
            hidden = true,
            lastAlertAt = 1000L,
            now = 1000L + BELL_COOLDOWN_MS,
        )

        assertTrue(result)
    }

    @Test
    fun `builds title with session name`() {
        assertEquals("🔔 my-session needs you — tmux-web", buildBellTitle("my-session"))
    }

    @Test
    fun `builds fallback title when session name is null or blank`() {
        assertEquals("🔔 session needs you — tmux-web", buildBellTitle(null))
        assertEquals("🔔 session needs you — tmux-web", buildBellTitle(""))
    }
}
