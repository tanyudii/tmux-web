package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.domain.model.ChangedFile
import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.FileStatus
import com.tanyudii.tmuxweb.domain.model.GroupedChanges
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * [buildChangeRows] flattens the per-section [com.tanyudii.tmuxweb.domain.buildFileTree]
 * output into the single ordered row list [ChangesRail] renders, honoring
 * which folders/groups are currently collapsed. Mirrors
 * `FileTreeTest`'s style since it composes on top of that same pure
 * tree-builder.
 */
class ChangesTreeTest {
    private fun file(path: String) = ChangedFile(path = path, oldPath = null, status = FileStatus.MODIFIED, staged = false)

    private fun changes(
        staged: List<String> = emptyList(),
        unstaged: List<String> = emptyList(),
        untracked: List<String> = emptyList(),
    ) = GroupedChanges(staged.map(::file), unstaged.map(::file), untracked.map(::file))

    @Test
    fun `null changes produce no rows`() {
        assertEquals(emptyList(), buildChangeRows(null, collapsedKeys = emptySet()))
    }

    @Test
    fun `empty changes produce no rows`() {
        assertEquals(emptyList(), buildChangeRows(changes(), collapsedKeys = emptySet()))
    }

    @Test
    fun `each non-empty section gets a group header row and empty sections are skipped`() {
        val rows = buildChangeRows(changes(staged = listOf("a.txt"), unstaged = listOf("b.txt")), collapsedKeys = emptySet())

        val headers = rows.filterIsInstance<ChangeRow.GroupHeader>()
        assertEquals(listOf(DiffMode.STAGED, DiffMode.UNSTAGED), headers.map { it.mode })
        assertEquals(listOf("Staged", "Changes"), headers.map { it.label })
    }

    @Test
    fun `nested folder expands under its folder node when not collapsed`() {
        val rows = buildChangeRows(changes(staged = listOf("src/a.kt", "src/b.kt")), collapsedKeys = emptySet())

        val nodes = rows.filterIsInstance<ChangeRow.Node>()
        assertEquals(listOf("src", "a.kt", "b.kt"), nodes.map { it.node.name })
        assertEquals(listOf(1, 2, 2), nodes.map { it.depth })
    }

    @Test
    fun `collapsing a folder key hides its descendant rows but keeps the folder row itself`() {
        val allExpanded = buildChangeRows(changes(staged = listOf("src/a.kt", "src/b.kt")), collapsedKeys = emptySet())
        val folderKey = allExpanded.filterIsInstance<ChangeRow.Node>().first { it.node.name == "src" }.key

        val rows = buildChangeRows(changes(staged = listOf("src/a.kt", "src/b.kt")), collapsedKeys = setOf(folderKey))

        assertEquals(listOf("src"), rows.filterIsInstance<ChangeRow.Node>().map { it.node.name })
    }

    @Test
    fun `collapsing a group key hides all its rows except the header`() {
        val allExpanded = buildChangeRows(changes(staged = listOf("a.txt")), collapsedKeys = emptySet())
        val groupKey = allExpanded.filterIsInstance<ChangeRow.GroupHeader>().first().key

        val rows = buildChangeRows(changes(staged = listOf("a.txt")), collapsedKeys = setOf(groupKey))

        assertTrue(rows.filterIsInstance<ChangeRow.Node>().isEmpty())
        assertEquals(1, rows.filterIsInstance<ChangeRow.GroupHeader>().size)
    }

    @Test
    fun `same folder name in different sections does not cross-collapse`() {
        val base = changes(staged = listOf("shared/a.kt"), unstaged = listOf("shared/b.kt"))
        val allExpanded = buildChangeRows(base, collapsedKeys = emptySet())
        val stagedFolderKey = allExpanded.filterIsInstance<ChangeRow.Node>()
            .first { it.mode == DiffMode.STAGED && it.node.name == "shared" }.key

        val rows = buildChangeRows(base, collapsedKeys = setOf(stagedFolderKey))

        val unstagedNodeNames = rows.filterIsInstance<ChangeRow.Node>().filter { it.mode == DiffMode.UNSTAGED }.map { it.node.name }
        assertEquals(listOf("shared", "b.kt"), unstagedNodeNames)
        val stagedNodeNames = rows.filterIsInstance<ChangeRow.Node>().filter { it.mode == DiffMode.STAGED }.map { it.node.name }
        assertEquals(listOf("shared"), stagedNodeNames)
    }

    @Test
    fun `group header count reflects total file count in that section regardless of collapse`() {
        val rows = buildChangeRows(
            changes(untracked = listOf("x.txt", "dir/y.txt")),
            collapsedKeys = setOf("group:UNTRACKED"),
        )

        val header = rows.filterIsInstance<ChangeRow.GroupHeader>().single()
        assertEquals(2, header.count)
        assertEquals(DiffMode.UNTRACKED, header.mode)
    }
}
