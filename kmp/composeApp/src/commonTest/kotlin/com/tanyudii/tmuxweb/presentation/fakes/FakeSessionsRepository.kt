package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.domain.model.PendingSessionCreation
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.domain.model.SessionCreationStatus
import com.tanyudii.tmuxweb.domain.repository.SessionsRepository

class FakeSessionsRepository(initialSessions: List<ProjectSession> = emptyList()) : SessionsRepository {
    val sessions = initialSessions.toMutableList()
    var listError: Throwable? = null
    var deleteError: Throwable? = null
    var startCreationError: Throwable? = null

    /** Queue of statuses `sessionCreationStatus` returns in order, one per poll tick. */
    val creationStatusQueue = ArrayDeque<Result<SessionCreationStatus>>()

    override suspend fun listSessions(projectId: String): List<ProjectSession> {
        listError?.let { throw it }
        return sessions.toList()
    }

    override suspend fun startSessionCreation(projectId: String, name: String): PendingSessionCreation {
        startCreationError?.let { throw it }
        return PendingSessionCreation(name = name, fullName = "${projectId}__$name")
    }

    override suspend fun sessionCreationStatus(projectId: String, sessionName: String): SessionCreationStatus {
        val next = creationStatusQueue.removeFirstOrNull()
            ?: error("FakeSessionsRepository: no more queued creation statuses")
        return next.getOrThrow()
    }

    override suspend fun deleteSession(projectId: String, sessionName: String, force: Boolean) {
        deleteError?.let { throw it }
        sessions.removeAll { it.name == sessionName }
    }
}
