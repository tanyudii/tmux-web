package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.EnvFile
import com.tanyudii.tmuxweb.domain.model.EnvFileListResponse
import com.tanyudii.tmuxweb.domain.model.EnvStatus
import kotlinx.serialization.Serializable

/** Mirrors the `/api/projects/:id/sessions/:slug/env` endpoints — see plan §2.2. */
interface EnvironmentRepository {
    suspend fun envStatus(projectId: String, sessionName: String): EnvStatus
    suspend fun startEnv(projectId: String, sessionName: String)
    suspend fun stopEnv(projectId: String, sessionName: String)
    suspend fun cancelEnv(projectId: String, sessionName: String)
    suspend fun listEnvFiles(projectId: String, sessionName: String): List<EnvFile>
    suspend fun readEnvFile(projectId: String, sessionName: String, filename: String): EnvFile
    suspend fun writeEnvFile(projectId: String, sessionName: String, filename: String, content: String)
}

@Serializable
private data class WriteEnvFileRequest(val content: String)

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

    override suspend fun listEnvFiles(projectId: String, sessionName: String): List<EnvFile> =
        client.getJson<EnvFileListResponse>("/api/projects/$projectId/sessions/$sessionName/env-files").files

    override suspend fun readEnvFile(projectId: String, sessionName: String, filename: String): EnvFile =
        client.getJson("/api/projects/$projectId/sessions/$sessionName/env-files/$filename")

    override suspend fun writeEnvFile(projectId: String, sessionName: String, filename: String, content: String) {
        client.putJson(
            "/api/projects/$projectId/sessions/$sessionName/env-files/$filename",
            WriteEnvFileRequest(content),
        )
    }
}
