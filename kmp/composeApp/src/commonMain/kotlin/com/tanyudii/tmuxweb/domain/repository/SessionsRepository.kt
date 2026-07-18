package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.BranchMergedResponse
import com.tanyudii.tmuxweb.domain.model.NewSessionRequest
import com.tanyudii.tmuxweb.domain.model.PendingSessionCreation
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.domain.model.SessionCreationStatus
import com.tanyudii.tmuxweb.domain.model.SessionListResponse
import com.tanyudii.tmuxweb.domain.model.SessionMetaRequest

/** Mirrors the `/api/projects/:id/sessions*` endpoints (src/server.ts) — see plan §2.2. */
interface SessionsRepository {
    suspend fun listSessions(projectId: String): List<ProjectSession>
    suspend fun startSessionCreation(
        projectId: String,
        name: String,
        startupCommand: String? = null,
    ): PendingSessionCreation
    suspend fun sessionCreationStatus(projectId: String, sessionName: String): SessionCreationStatus
    suspend fun deleteSession(
        projectId: String,
        sessionName: String,
        force: Boolean = false,
        deleteBranch: Boolean = false,
    )

    /** Tears down the EMB-217 split viewport's linked tmux session -- see killProjectSessionSplit (src/server.ts). */
    suspend fun closeSplitPane(projectId: String, sessionName: String)

    /** EMB-207: read-only pre-check backing the "Delete branch too" checkbox's unmerged-branch warning. */
    suspend fun isBranchMerged(projectId: String, sessionName: String): Boolean

    /** EMB-222: sets (or clears, when label is null and favorite is false) a session's label/favorite flag. */
    suspend fun setSessionMeta(projectId: String, sessionName: String, label: String?, favorite: Boolean)
}

class KtorSessionsRepository(private val client: TmuxWebHttpClient) : SessionsRepository {
    override suspend fun listSessions(projectId: String): List<ProjectSession> =
        client.getJson<SessionListResponse>("/api/projects/$projectId/sessions").sessions

    override suspend fun startSessionCreation(
        projectId: String,
        name: String,
        startupCommand: String?,
    ): PendingSessionCreation =
        client.postJson("/api/projects/$projectId/sessions", NewSessionRequest(name, startupCommand))

    override suspend fun sessionCreationStatus(projectId: String, sessionName: String): SessionCreationStatus =
        client.getJson("/api/projects/$projectId/sessions/$sessionName/creation")

    override suspend fun deleteSession(projectId: String, sessionName: String, force: Boolean, deleteBranch: Boolean) {
        val params = buildMap {
            if (force) put("force", "true")
            if (deleteBranch) put("deleteBranch", "true")
        }
        client.delete("/api/projects/$projectId/sessions/$sessionName", params)
    }

    override suspend fun closeSplitPane(projectId: String, sessionName: String) {
        client.delete("/api/projects/$projectId/sessions/$sessionName/split")
    }

    override suspend fun isBranchMerged(projectId: String, sessionName: String): Boolean =
        client.getJson<BranchMergedResponse>("/api/projects/$projectId/sessions/$sessionName/branch-merged").merged

    override suspend fun setSessionMeta(projectId: String, sessionName: String, label: String?, favorite: Boolean) {
        client.putJson("/api/projects/$projectId/sessions/$sessionName/meta", SessionMetaRequest(label, favorite))
    }
}
