package com.tanyudii.tmuxweb.domain

import com.tanyudii.tmuxweb.domain.model.ProjectSession

/**
 * EMB-221: session-list status filter. "Status" here means whether the
 * session is currently attached (someone has a terminal open on it) --
 * the only real-time status signal already present on every
 * [ProjectSession] with no extra per-session network round trip. Live
 * environment (docker) running/idle status needs a `docker compose ps`
 * call per session (see SessionResourceUsageViewModel) and isn't cheap
 * enough to run for every row in a list, so it's out of scope here.
 */
enum class SessionStatusFilter { ALL, ACTIVE, IDLE }

/**
 * Pure, DOM-free filter so it's directly testable from commonTest -- same
 * split as [isFindShortcut]/[isCopyShortcut]. Branch matching is a
 * case-insensitive substring match against [ProjectSession.name], which
 * doubles as the git branch name for every session (see
 * `slugifyBranchName`/`addWorktree` in src/project-sessions.ts) -- there's
 * no separate `branch` field on [ProjectSession] to filter on instead.
 */
fun filterSessions(
    sessions: List<ProjectSession>,
    statusFilter: SessionStatusFilter,
    branchQuery: String,
): List<ProjectSession> {
    val query = branchQuery.trim()
    return sessions.filter { session ->
        val matchesStatus = when (statusFilter) {
            SessionStatusFilter.ALL -> true
            SessionStatusFilter.ACTIVE -> session.attached
            SessionStatusFilter.IDLE -> !session.attached
        }
        val matchesBranch = query.isEmpty() || session.name.contains(query, ignoreCase = true)
        matchesStatus && matchesBranch
    }
}
