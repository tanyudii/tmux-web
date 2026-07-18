package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.domain.model.SessionEvent
import com.tanyudii.tmuxweb.domain.repository.SessionEventsRepository

class FakeSessionEventsRepository(private val events: List<SessionEvent> = emptyList()) : SessionEventsRepository {
    var listError: Throwable? = null

    override suspend fun listEvents(projectId: String, sessionName: String): List<SessionEvent> {
        listError?.let { throw it }
        return events
    }
}
