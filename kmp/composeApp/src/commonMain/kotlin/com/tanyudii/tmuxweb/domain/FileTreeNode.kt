package com.tanyudii.tmuxweb.domain

import com.tanyudii.tmuxweb.domain.model.ChangedFile

/**
 * One node in the folder tree [buildFileTree] groups a flat [ChangedFile]
 * list into. [file] is set only on leaf (file) nodes; folder nodes carry
 * `null` and derive their children from every path that shares their
 * prefix. Mirrors `buildFileTree`/`renderTreeChildren` in public/app.js and
 * FileTree.swift — folders sort before files, both alphabetically.
 */
data class FileTreeNode(
    val name: String,
    val children: List<FileTreeNode>,
    val file: ChangedFile?,
) {
    val id: String get() = file?.path ?: name
    val isFolder: Boolean get() = file == null
}

/** Pure function so tree-grouping logic is testable in isolation from any UI layer. */
fun buildFileTree(files: List<ChangedFile>): List<FileTreeNode> {
    val entries = files
        .map { file -> file.path.split("/").filter { it.isNotEmpty() } to file }
        // A path that splits to an empty list (e.g. an empty string) would crash
        // buildLevel's first-segment grouping below — drop it defensively, since
        // an empty path can't be rendered as a tree node anyway. Not currently
        // reachable via `git status --porcelain` (paths are never empty there),
        // but ChangedFile.path is server-decoded JSON with no type-level
        // non-emptiness guarantee.
        .filter { (segments, _) -> segments.isNotEmpty() }
    return buildLevel(entries)
}

private fun buildLevel(entries: List<Pair<List<String>, ChangedFile>>): List<FileTreeNode> {
    val grouped = entries.groupBy { (segments, _) -> segments.first() }

    val nodes = grouped.map { (name, group) ->
        val leaf = group.firstOrNull { (segments, _) -> segments.size == 1 }
        val deeper = group
            .filter { (segments, _) -> segments.size > 1 }
            .map { (segments, file) -> segments.drop(1) to file }

        FileTreeNode(name = name, children = buildLevel(deeper), file = leaf?.second)
    }

    return nodes.sortedWith(
        compareByDescending<FileTreeNode> { it.isFolder }.thenBy { it.name },
    )
}
