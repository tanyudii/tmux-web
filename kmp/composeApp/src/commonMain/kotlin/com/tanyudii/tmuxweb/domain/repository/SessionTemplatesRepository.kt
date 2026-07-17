package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.NewSessionTemplateRequest
import com.tanyudii.tmuxweb.domain.model.SessionTemplate
import com.tanyudii.tmuxweb.domain.model.SessionTemplateListResponse
import com.tanyudii.tmuxweb.domain.model.UpdateSessionTemplateRequest

/** Mirrors the `/api/projects/:id/templates*` endpoints (src/server.ts, EMB-220). */
interface SessionTemplatesRepository {
    suspend fun listTemplates(projectId: String): List<SessionTemplate>
    suspend fun createTemplate(projectId: String, name: String, startupCommand: String?): SessionTemplate
    suspend fun updateTemplate(
        projectId: String,
        templateId: String,
        name: String,
        startupCommand: String?,
    ): SessionTemplate
    suspend fun deleteTemplate(projectId: String, templateId: String)
}

class KtorSessionTemplatesRepository(private val client: TmuxWebHttpClient) : SessionTemplatesRepository {
    override suspend fun listTemplates(projectId: String): List<SessionTemplate> =
        client.getJson<SessionTemplateListResponse>("/api/projects/$projectId/templates").templates

    override suspend fun createTemplate(projectId: String, name: String, startupCommand: String?): SessionTemplate =
        client.postJson("/api/projects/$projectId/templates", NewSessionTemplateRequest(name, startupCommand))

    override suspend fun updateTemplate(
        projectId: String,
        templateId: String,
        name: String,
        startupCommand: String?,
    ): SessionTemplate {
        // TmuxWebHttpClient.putJson only returns the raw HttpResponse (its
        // one existing caller, writeEnvFile, discards the body) -- decode it
        // here via the client's own decodeBody rather than adding a second
        // `putJson` overload that would collide with the existing one on
        // erased signature (same param types, only the reified return type
        // would differ).
        val response = client.putJson(
            "/api/projects/$projectId/templates/$templateId",
            UpdateSessionTemplateRequest(name, startupCommand),
        )
        return client.decodeBody(response)
    }

    override suspend fun deleteTemplate(projectId: String, templateId: String) {
        client.delete("/api/projects/$projectId/templates/$templateId")
    }
}
