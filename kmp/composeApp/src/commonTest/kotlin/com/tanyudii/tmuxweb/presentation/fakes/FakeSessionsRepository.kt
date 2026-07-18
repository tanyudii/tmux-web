package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.domain.model.PendingSessionCreation
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.domain.model.SessionCreationStatus
import com.tanyudii.tmuxweb.domain.repository.SessionsRepository

class FakeSessionsRepository(initialSessions: List<ProjectSession> = emptyList()) : SessionsRepository {
    val sessions = initialSessions.toMutableList()
    var listError: Throwable? = null
    var deleteError: Throwable? = null

    /** Per-session override checked before the global [deleteError] -- lets bulk-delete
     * tests script "session A conflicts, session B succeeds" in one repository instance. */
    val deleteErrors: MutableMap<String, Throwable> = mutableMapOf()
    var startCreationError: Throwable? = null
    var closeSplitPaneError: Throwable? = null
    val closeSplitPaneCalls = mutableListOf<Pair<String, String>>()
    var branchMerged = true
    val deleteSessionCalls = mutableListOf<Triple<String, Boolean, Boolean>>()
    var setSessionMetaError: Throwable? = null
    val setSessionMetaCalls = mutableListOf<Triple<String, String?, Boolean>>()

    /** Queue of statuses `sessionCreationStatus` returns in order, one per poll tick. */
    val creationStatusQueue = ArrayDeque<Result<SessionCreationStatus>>()
    val startCreationCalls = mutableListOf<Triple<String, String, String?>>()

    override suspend fun listSessions(projectId: String): List<ProjectSession> {
        listError?.let { throw it }
        return sessions.toList()
    }

    override suspend fun startSessionCreation(
        projectId: String,
        name: String,
        startupCommand: String?,
    ): PendingSessionCreation {
        startCreationCalls.add(Triple(projectId, name, startupCommand))
        startCreationError?.let { throw it }
        return PendingSessionCreation(name = name, fullName = "${projectId}__$name")
    }

    override suspend fun sessionCreationStatus(projectId: String, sessionName: String): SessionCreationStatus {
        val next = creationStatusQueue.removeFirstOrNull()
            ?: error("FakeSessionsRepository: no more queued creation statuses")
        return next.getOrThrow()
    }

    override suspend fun deleteSession(projectId: String, sessionName: String, force: Boolean, deleteBranch: Boolean) {
        deleteSessionCalls.add(Triple(sessionName, force, deleteBranch))
        (deleteErrors[sessionName] ?: deleteError)?.let { throw it }
        sessions.removeAll { it.name == sessionName }
    }

    override suspend fun closeSplitPane(projectId: String, sessionName: String) {
        closeSplitPaneError?.let { throw it }
        closeSplitPaneCalls.add(projectId to sessionName)
    }

    override suspend fun isBranchMerged(projectId: String, sessionName: String): Boolean = branchMerged

    override suspend fun setSessionMeta(projectId: String, sessionName: String, label: String?, favorite: Boolean) {
        setSessionMetaCalls.add(Triple(sessionName, label, favorite))
        setSessionMetaError?.let { throw it }
        val index = sessions.indexOfFirst { it.name == sessionName }
        if (index != -1) sessions[index] = sessions[index].copy(label = label, favorite = favorite)
    }
}
