package com.tanyudii.tmuxweb.domain.model

import kotlinx.serialization.Serializable

/** Mirrors `ProjectSession` in src/project-sessions.ts. */
@Serializable
data class ProjectSession(
    val name: String,
    val fullName: String,
    val windows: Int,
    val attached: Boolean,
)

@Serializable
data class SessionListResponse(val sessions: List<ProjectSession>)

@Serializable
data class NewSessionRequest(val name: String)
