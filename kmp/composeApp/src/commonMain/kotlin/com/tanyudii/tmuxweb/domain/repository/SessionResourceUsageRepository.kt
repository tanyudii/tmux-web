package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.SessionResourceUsage

/** Mirrors the read-only `GET .../sessions/:name/resource-usage` endpoint (src/server.ts, EMB-214). */
interface SessionResourceUsageRepository {
    suspend fun getUsage(projectId: String, sessionName: String): SessionResourceUsage
}

class KtorSessionResourceUsageRepository(private val client: TmuxWebHttpClient) : SessionResourceUsageRepository {
    override suspend fun getUsage(projectId: String, sessionName: String): SessionResourceUsage =
        client.getJson("/api/projects/$projectId/sessions/$sessionName/resource-usage")
}
