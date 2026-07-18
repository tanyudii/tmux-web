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

// "Conflicted" deliberately reuses DiffMode.UNSTAGED: an unmerged path's
// stage/discard actions are the same underlying operations as a regular
// unstaged file's (git add to mark it resolved, git checkout HEAD to
// discard it) -- see EMB-208. Row/group keys below are derived from
// section.label, NOT this mode, precisely so two sections sharing a mode
// don't collide (LazyColumn's `key = { it.key }` would crash on a
// duplicate key otherwise).
private val SECTIONS = listOf(
    ChangeSection("Staged", DiffMode.STAGED) { it.staged },
    ChangeSection("Changes", DiffMode.UNSTAGED) { it.unstaged },
    ChangeSection("Conflicted", DiffMode.UNSTAGED) { it.conflicted },
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
        val groupKey = groupKey(section.label)
        val header = ChangeRow.GroupHeader(mode = mode, label = section.label, count = files.size, key = groupKey)
        if (groupKey in collapsedKeys) {
            listOf(header)
        } else {
            listOf(header) +
                flattenNodes(buildFileTree(files), mode, section.label, depth = 1, pathPrefix = "", collapsedKeys)
        }
    }
}

private fun groupKey(sectionLabel: String): String = "group:$sectionLabel"

private fun flattenNodes(
    nodes: List<FileTreeNode>,
    mode: DiffMode,
    sectionLabel: String,
    depth: Int,
    pathPrefix: String,
    collapsedKeys: Set<String>,
): List<ChangeRow> = nodes.flatMap { node ->
    val path = if (pathPrefix.isEmpty()) node.name else "$pathPrefix/${node.name}"
    val key = "$sectionLabel:$path"
    val row = ChangeRow.Node(node = node, mode = mode, depth = depth, key = key)
    // Gated on `children.isNotEmpty()` rather than `node.isFolder` (`file == null`):
    // a node can have BOTH a non-null `file` and non-empty `children` when a
    // changed path collides with a deeper one in the same section (e.g. `git rm
    // src && mkdir src && git add src/x.txt` stages a deletion of the file "src"
    // alongside an addition of "src/x.txt"). Gating on `isFolder` alone silently
    // dropped that node's descendants -- see ChangesTreeTest's collision case.
    if (node.children.isNotEmpty() && key !in collapsedKeys) {
        listOf(row) + flattenNodes(node.children, mode, sectionLabel, depth + 1, path, collapsedKeys)
    } else {
        listOf(row)
    }
}
