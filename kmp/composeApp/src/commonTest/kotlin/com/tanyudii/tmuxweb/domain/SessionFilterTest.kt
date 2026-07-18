package com.tanyudii.tmuxweb.domain

import com.tanyudii.tmuxweb.domain.model.ProjectSession
import kotlin.test.Test
import kotlin.test.assertEquals

class SessionFilterTest {
    private fun session(name: String, attached: Boolean) = ProjectSession(
        name = name,
        fullName = "proj__$name",
        windows = 1,
        attached = attached,
    )

    @Test
    fun `ALL status with empty query returns every session`() {
        val sessions = listOf(session("feature-a", attached = true), session("feature-b", attached = false))

        val result = filterSessions(sessions, SessionStatusFilter.ALL, branchQuery = "")

        assertEquals(sessions, result)
    }

    @Test
    fun `ACTIVE status filter keeps only attached sessions`() {
        val active = session("feature-a", attached = true)
        val idle = session("feature-b", attached = false)

        val result = filterSessions(listOf(active, idle), SessionStatusFilter.ACTIVE, branchQuery = "")

        assertEquals(listOf(active), result)
    }

    @Test
    fun `IDLE status filter keeps only detached sessions`() {
        val active = session("feature-a", attached = true)
        val idle = session("feature-b", attached = false)

        val result = filterSessions(listOf(active, idle), SessionStatusFilter.IDLE, branchQuery = "")

        assertEquals(listOf(idle), result)
    }

    @Test
    fun `branch query matches case-insensitively as a substring`() {
        val target = session("Feature-Login", attached = true)
        val other = session("bugfix-nav", attached = true)

        val result = filterSessions(listOf(target, other), SessionStatusFilter.ALL, branchQuery = "login")

        assertEquals(listOf(target), result)
    }

    @Test
    fun `blank branch query is treated as no filter`() {
        val sessions = listOf(session("feature-a", attached = true), session("feature-b", attached = false))

        val result = filterSessions(sessions, SessionStatusFilter.ALL, branchQuery = "   ")

        assertEquals(sessions, result)
    }

    @Test
    fun `status and branch filters combine with AND semantics`() {
        val match = session("feature-login", attached = true)
        val wrongStatus = session("feature-logout", attached = false)
        val wrongBranch = session("bugfix-nav", attached = true)

        val result = filterSessions(
            listOf(match, wrongStatus, wrongBranch),
            SessionStatusFilter.ACTIVE,
            branchQuery = "feature",
        )

        assertEquals(listOf(match), result)
    }

    @Test
    fun `no matches returns an empty list`() {
        val sessions = listOf(session("feature-a", attached = true))

        val result = filterSessions(sessions, SessionStatusFilter.ALL, branchQuery = "nonexistent")

        assertEquals(emptyList(), result)
    }
}
