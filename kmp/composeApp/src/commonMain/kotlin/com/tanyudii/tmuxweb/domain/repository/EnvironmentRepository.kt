package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.EnvStatus

/** Mirrors the `/api/projects/:id/sessions/:slug/env` endpoints — see plan §2.2. */
interface EnvironmentRepository {
    suspend fun envStatus(projectId: String, sessionName: String): EnvStatus
    suspend fun startEnv(projectId: String, sessionName: String)
    suspend fun stopEnv(projectId: String, sessionName: String)
    suspend fun cancelEnv(projectId: String, sessionName: String)
}

class KtorEnvironmentRepository(private val client: TmuxWebHttpClient) : EnvironmentRepository {
    override suspend fun envStatus(projectId: String, sessionName: String): EnvStatus =
        client.getJson("/api/projects/$projectId/sessions/$sessionName/env")

    override suspend fun startEnv(projectId: String, sessionName: String) {
        client.post("/api/projects/$projectId/sessions/$sessionName/env")
    }

    override suspend fun stopEnv(projectId: String, sessionName: String) {
        client.delete("/api/projects/$projectId/sessions/$sessionName/env")
    }

    override suspend fun cancelEnv(projectId: String, sessionName: String) {
        client.post("/api/projects/$projectId/sessions/$sessionName/env/cancel")
    }
}
