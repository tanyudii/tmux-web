package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.domain.FileTreeNode
import com.tanyudii.tmuxweb.domain.buildFileTree
import com.tanyudii.tmuxweb.domain.model.ChangedFile
import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.GroupedChanges

/** One visible row in [com.tanyudii.tmuxweb.ui.web.ChangesRail]'s flattened tree list. */
sealed interface ChangeRow {
    val key: String

    /** Section header ("Staged"/"Changes"/"Untracked") — [count] is the total file count, even while collapsed. */
    data class GroupHeader(val mode: DiffMode, val label: String, val count: Int, override val key: String) : ChangeRow

    /** A folder or file node from [buildFileTree], at [depth] levels of indentation under its [mode]'s section. */
    data class Node(val node: FileTreeNode, val mode: DiffMode, val depth: Int, override val key: String) : ChangeRow
}

private class ChangeSection(val label: String, val mode: DiffMode, val filesOf: (GroupedChanges) -> List<ChangedFile>)

private val SECTIONS = listOf(
    ChangeSection("Staged", DiffMode.STAGED) { it.staged },
    ChangeSection("Changes", DiffMode.UNSTAGED) { it.unstaged },
    ChangeSection("Untracked", DiffMode.UNTRACKED) { it.untracked },
)

/**
 * Flattens [changes] into the single ordered row list [ChangesRail] renders
 * as a flat `LazyColumn` — recursive composables inside a `LazyColumn` don't
 * lazily flatten on their own, so the collapse-aware flattening happens here
 * as a pure function instead, independently testable from Compose.
 *
 * [collapsedKeys] holds both group keys (`"group:<MODE>"`) and folder keys
 * (`"<MODE>:<path>"`, see [ChangeRow.Node.key]) currently collapsed by the
 * user; a collapsed group/folder still emits its own header/node row, just
 * not its descendants.
 */
fun buildChangeRows(changes: GroupedChanges?, collapsedKeys: Set<String>): List<ChangeRow> {
    if (changes == null) return emptyList()
    return SECTIONS.flatMap { section ->
        val files = section.filesOf(changes)
        if (files.isEmpty()) return@flatMap emptyList()
        val mode = section.mode
        val groupKey = groupKey(mode)
        val header = ChangeRow.GroupHeader(mode = mode, label = section.label, count = files.size, key = groupKey)
        if (groupKey in collapsedKeys) {
            listOf(header)
        } else {
            listOf(header) + flattenNodes(buildFileTree(files), mode, depth = 1, pathPrefix = "", collapsedKeys)
        }
    }
}

private fun groupKey(mode: DiffMode): String = "group:${mode.name}"

private fun flattenNodes(
    nodes: List<FileTreeNode>,
    mode: DiffMode,
    depth: Int,
    pathPrefix: String,
    collapsedKeys: Set<String>,
): List<ChangeRow> = nodes.flatMap { node ->
    val path = if (pathPrefix.isEmpty()) node.name else "$pathPrefix/${node.name}"
    val key = "${mode.name}:$path"
    val row = ChangeRow.Node(node = node, mode = mode, depth = depth, key = key)
    if (node.isFolder && key !in collapsedKeys) {
        listOf(row) + flattenNodes(node.children, mode, depth + 1, path, collapsedKeys)
    } else {
        listOf(row)
    }
}
