package com.tanyudii.tmuxweb.domain.model

import kotlinx.serialization.Serializable

/** Mirrors `Project` in src/projects.ts (backend contract, frozen — see the plan §2.4). */
@Serializable
data class Project(
    val id: String,
    val name: String,
    val repoPath: String,
    val createdAt: String,
)

@Serializable
data class ProjectListResponse(val projects: List<Project>)

@Serializable
data class NewProjectRequest(val name: String, val repoPath: String)
