package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.NewSessionRequest
import com.tanyudii.tmuxweb.domain.model.PendingSessionCreation
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.domain.model.SessionCreationStatus
import com.tanyudii.tmuxweb.domain.model.SessionListResponse

/** Mirrors the `/api/projects/:id/sessions*` endpoints (src/server.ts) — see plan §2.2. */
interface SessionsRepository {
    suspend fun listSessions(projectId: String): List<ProjectSession>
    suspend fun startSessionCreation(projectId: String, name: String): PendingSessionCreation
    suspend fun sessionCreationStatus(projectId: String, sessionName: String): SessionCreationStatus
    suspend fun deleteSession(projectId: String, sessionName: String, force: Boolean = false)
}

class KtorSessionsRepository(private val client: TmuxWebHttpClient) : SessionsRepository {
    override suspend fun listSessions(projectId: String): List<ProjectSession> =
        client.getJson<SessionListResponse>("/api/projects/$projectId/sessions").sessions

    override suspend fun startSessionCreation(projectId: String, name: String): PendingSessionCreation =
        client.postJson("/api/projects/$projectId/sessions", NewSessionRequest(name))

    override suspend fun sessionCreationStatus(projectId: String, sessionName: String): SessionCreationStatus =
        client.getJson("/api/projects/$projectId/sessions/$sessionName/creation")

    override suspend fun deleteSession(projectId: String, sessionName: String, force: Boolean) {
        client.delete(
            "/api/projects/$projectId/sessions/$sessionName",
            if (force) mapOf("force" to "true") else emptyMap(),
        )
    }
}
