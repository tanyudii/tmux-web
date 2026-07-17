package com.tanyudii.tmuxweb.domain.model

import kotlinx.serialization.Serializable

/** Mirrors `SessionTemplate` in src/session-templates.ts. */
@Serializable
data class SessionTemplate(
    val id: String,
    val projectId: String,
    val name: String,
    val startupCommand: String? = null,
    val createdAt: String,
)

@Serializable
data class SessionTemplateListResponse(val templates: List<SessionTemplate>)

@Serializable
data class NewSessionTemplateRequest(val name: String, val startupCommand: String? = null)

@Serializable
data class UpdateSessionTemplateRequest(val name: String, val startupCommand: String? = null)
