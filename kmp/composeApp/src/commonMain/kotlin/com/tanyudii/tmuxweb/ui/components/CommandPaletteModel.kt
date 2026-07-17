package com.tanyudii.tmuxweb.ui.components

import com.tanyudii.tmuxweb.domain.fuzzyMatchRank
import com.tanyudii.tmuxweb.domain.fuzzyMatches
import com.tanyudii.tmuxweb.domain.model.Project
import com.tanyudii.tmuxweb.domain.model.ProjectSession

/** One searchable entry -- a project or one of its sessions. See TmuxCommandPalette.kt for the UI. */
sealed interface CommandPaletteItem {
    val id: String
    val label: String
    val sublabel: String?

    data class ProjectEntry(val projectId: String, override val label: String) : CommandPaletteItem {
        override val id: String = "project:$projectId"
        override val sublabel: String? = null
    }

    data class SessionEntry(
        val projectId: String,
        val sessionName: String,
        override val label: String,
        val projectName: String,
    ) : CommandPaletteItem {
        override val id: String = "session:$projectId:$sessionName"
        override val sublabel: String = projectName
    }
}

/**
 * Flattens the sidebar's project+session tree into a plain searchable list
 * -- takes the same two shapes [com.tanyudii.tmuxweb.presentation.WebShellUiState]
 * already holds (rather than that whole UiState type) so this stays a
 * components/ file that only knows about domain models, not one specific
 * screen's presentation state.
 */
fun buildCommandPaletteItems(
    projects: List<Project>,
    sessionsByProjectId: Map<String, List<ProjectSession>>,
): List<CommandPaletteItem> {
    val projectItems = projects.map { CommandPaletteItem.ProjectEntry(it.id, it.label()) }
    val sessionItems = projects.flatMap { project ->
        sessionsByProjectId[project.id].orEmpty().map { session ->
            CommandPaletteItem.SessionEntry(project.id, session.name, session.name, project.label())
        }
    }
    return projectItems + sessionItems
}

private fun Project.label(): String = name.ifBlank { id }

private fun itemRank(query: String, item: CommandPaletteItem): Int {
    val sublabelRank = item.sublabel?.let { fuzzyMatchRank(query, it) } ?: Int.MAX_VALUE
    return minOf(fuzzyMatchRank(query, item.label), sublabelRank)
}

fun filterAndRankItems(items: List<CommandPaletteItem>, query: String): List<CommandPaletteItem> =
    items
        .filter { fuzzyMatches(query, it.label) || (it.sublabel != null && fuzzyMatches(query, it.sublabel!!)) }
        .sortedBy { itemRank(query, it) }
