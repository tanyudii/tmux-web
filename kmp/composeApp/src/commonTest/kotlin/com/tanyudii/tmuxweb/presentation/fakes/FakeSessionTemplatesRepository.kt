package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.domain.model.SessionTemplate
import com.tanyudii.tmuxweb.domain.repository.SessionTemplatesRepository

class FakeSessionTemplatesRepository(initialTemplates: List<SessionTemplate> = emptyList()) :
    SessionTemplatesRepository {
    val templates = initialTemplates.toMutableList()
    var listError: Throwable? = null
    var createError: Throwable? = null
    var deleteError: Throwable? = null
    private var nextId = 0

    override suspend fun listTemplates(projectId: String): List<SessionTemplate> {
        listError?.let { throw it }
        return templates.filter { it.projectId == projectId }
    }

    override suspend fun createTemplate(projectId: String, name: String, startupCommand: String?): SessionTemplate {
        createError?.let { throw it }
        val template = SessionTemplate(
            id = "fake-template-${nextId++}",
            projectId = projectId,
            name = name,
            startupCommand = startupCommand,
            createdAt = "now",
        )
        templates.add(template)
        return template
    }

    override suspend fun updateTemplate(
        projectId: String,
        templateId: String,
        name: String,
        startupCommand: String?,
    ): SessionTemplate {
        val index = templates.indexOfFirst { it.id == templateId && it.projectId == projectId }
        check(index >= 0) { "FakeSessionTemplatesRepository: no template $templateId for project $projectId" }
        val updated = templates[index].copy(name = name, startupCommand = startupCommand)
        templates[index] = updated
        return updated
    }

    override suspend fun deleteTemplate(projectId: String, templateId: String) {
        deleteError?.let { throw it }
        templates.removeAll { it.id == templateId && it.projectId == projectId }
    }
}
