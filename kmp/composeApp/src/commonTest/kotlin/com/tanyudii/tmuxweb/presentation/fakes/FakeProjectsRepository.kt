package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.domain.model.Project
import com.tanyudii.tmuxweb.domain.repository.ProjectsRepository

class FakeProjectsRepository(initialProjects: List<Project> = emptyList()) : ProjectsRepository {
    val projects = initialProjects.toMutableList()
    var listError: Throwable? = null
    var deleteError: Throwable? = null

    override suspend fun listProjects(): List<Project> {
        listError?.let { throw it }
        return projects.toList()
    }

    override suspend fun createProject(name: String, repoPath: String): Project {
        val project = Project(id = "new-${projects.size}", name = name, repoPath = repoPath, createdAt = "now")
        projects.add(project)
        return project
    }

    override suspend fun deleteProject(id: String, force: Boolean) {
        deleteError?.let { throw it }
        projects.removeAll { it.id == id }
    }
}
