package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.SessionEvent
import com.tanyudii.tmuxweb.domain.model.SessionEventsResponse

/** Mirrors the read-only `GET .../sessions/:name/events` endpoint (src/server.ts, EMB-213). */
interface SessionEventsRepository {
    suspend fun listEvents(projectId: String, sessionName: String): List<SessionEvent>
}

class KtorSessionEventsRepository(private val client: TmuxWebHttpClient) : SessionEventsRepository {
    override suspend fun listEvents(projectId: String, sessionName: String): List<SessionEvent> =
        client.getJson<SessionEventsResponse>("/api/projects/$projectId/sessions/$sessionName/events").events
}
