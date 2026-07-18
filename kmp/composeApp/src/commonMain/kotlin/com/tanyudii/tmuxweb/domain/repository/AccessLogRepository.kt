package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.AccessLogEntry
import com.tanyudii.tmuxweb.domain.model.AccessLogResponse

/** Mirrors the read-only `GET /api/access-log` endpoint (src/server.ts, EMB-223). */
interface AccessLogRepository {
    suspend fun listEntries(): List<AccessLogEntry>
}

class KtorAccessLogRepository(private val client: TmuxWebHttpClient) : AccessLogRepository {
    override suspend fun listEntries(): List<AccessLogEntry> =
        client.getJson<AccessLogResponse>("/api/access-log").entries
}
