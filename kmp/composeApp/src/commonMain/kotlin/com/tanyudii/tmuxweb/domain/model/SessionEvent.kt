package com.tanyudii.tmuxweb.domain.model

import kotlinx.serialization.Serializable

/** Mirrors `SessionEvent` in src/session-events.ts (EMB-213). */
@Serializable
data class SessionEvent(
    val timestamp: String,
    val projectId: String,
    val sessionSlug: String,
    val type: String,
    val message: String? = null,
)

@Serializable
data class SessionEventsResponse(val events: List<SessionEvent>)
