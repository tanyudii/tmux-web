package com.tanyudii.tmuxweb.domain

import com.tanyudii.tmuxweb.domain.model.ChangedFile
import com.tanyudii.tmuxweb.domain.model.FileStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Ports ios/TmuxWebClientTests/FileTreeTests.swift 1:1 — same behavior
 * asserted against public/app.js's buildFileTree: folders sort before
 * files, both alphabetically, and nested paths group under a shared folder.
 */
class FileTreeTest {
    private fun file(path: String, status: FileStatus = FileStatus.MODIFIED) =
        ChangedFile(path = path, oldPath = null, status = status, staged = false)

    @Test
    fun `groups nested paths under shared folder`() {
        val tree = buildFileTree(listOf(file("a/b.txt"), file("a/c.txt")))

        assertEquals(1, tree.size)
        assertEquals("a", tree[0].name)
        assertTrue(tree[0].isFolder)
        assertEquals(listOf("b.txt", "c.txt"), tree[0].children.map { it.name })
    }

    @Test
    fun `sorts folders before files alphabetically`() {
        val tree = buildFileTree(listOf(file("z.txt"), file("a/nested.txt"), file("m.txt")))

        assertEquals(listOf("a", "m.txt", "z.txt"), tree.map { it.name })
        assertTrue(tree[0].isFolder)
        assertTrue(!tree[1].isFolder)
    }

    @Test
    fun `root level file has no children and carries its changed file`() {
        val tree = buildFileTree(listOf(file("README.md", status = FileStatus.ADDED)))

        assertEquals(1, tree.size)
        assertTrue(tree[0].children.isEmpty())
        assertEquals(FileStatus.ADDED, tree[0].file?.status)
    }

    @Test
    fun `deeply nested path builds multi level tree`() {
        val tree = buildFileTree(listOf(file("a/b/c/d.txt")))

        assertEquals("a", tree[0].name)
        assertEquals("b", tree[0].children[0].name)
        assertEquals("c", tree[0].children[0].children[0].name)
        assertEquals("d.txt", tree[0].children[0].children[0].children[0].name)
    }

    @Test
    fun `empty path is dropped instead of crashing`() {
        val tree = buildFileTree(listOf(file(""), file("a.txt")))

        assertEquals(1, tree.size)
        assertEquals("a.txt", tree[0].name)
    }
}
