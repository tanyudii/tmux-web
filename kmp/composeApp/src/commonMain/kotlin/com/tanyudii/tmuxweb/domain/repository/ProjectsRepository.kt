package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.NewProjectRequest
import com.tanyudii.tmuxweb.domain.model.Project
import com.tanyudii.tmuxweb.domain.model.ProjectListResponse

/** Mirrors the `/api/projects` endpoints (src/server.ts) — see plan §2.2. */
interface ProjectsRepository {
    suspend fun listProjects(): List<Project>
    suspend fun createProject(name: String, repoPath: String): Project
    suspend fun deleteProject(id: String, force: Boolean = false)
}

class KtorProjectsRepository(private val client: TmuxWebHttpClient) : ProjectsRepository {
    override suspend fun listProjects(): List<Project> =
        client.getJson<ProjectListResponse>("/api/projects").projects

    override suspend fun createProject(name: String, repoPath: String): Project =
        client.postJson("/api/projects", NewProjectRequest(name, repoPath))

    override suspend fun deleteProject(id: String, force: Boolean) {
        client.delete("/api/projects/$id", if (force) mapOf("force" to "true") else emptyMap())
    }
}
