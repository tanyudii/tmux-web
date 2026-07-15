package com.tanyudii.tmuxweb.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Ports public/diff-parser.test.js 1:1 (see commit 94514e6, removed from the repo in 2d3b55c's cutover to kmp/). */
class DiffLineParserTest {
    @Test
    fun `parses a single hunk with add, del and context lines`() {
        // Arrange
        val text = listOf(
            "diff --git a/file.txt b/file.txt",
            "index 111..222 100644",
            "--- a/file.txt",
            "+++ b/file.txt",
            "@@ -1,3 +1,3 @@",
            " unchanged",
            "-old line",
            "+new line",
            " trailing",
        ).joinToString("\n")

        // Act
        val parsed = parseUnifiedDiff(text)

        // Assert
        assertEquals(1, parsed.hunks.size)
        val hunk = parsed.hunks.first()
        assertEquals("@@ -1,3 +1,3 @@", hunk.header)
        assertEquals(1, parsed.additions)
        assertEquals(1, parsed.deletions)
        assertEquals(
            listOf(DiffRowType.CONTEXT, DiffRowType.DEL, DiffRowType.ADD, DiffRowType.CONTEXT),
            hunk.lines.map { it.type },
        )
    }

    @Test
    fun `numbers old and new lines independently across add-del`() {
        // Arrange
        val text = listOf("@@ -5,2 +5,2 @@", " ctx", "-removed", "+added").joinToString("\n")

        // Act
        val lines = parseUnifiedDiff(text).hunks.first().lines

        // Assert
        assertEquals(listOf(5, 6, null), lines.map { it.oldLineNo })
        assertEquals(listOf(5, null, 6), lines.map { it.newLineNo })
    }

    @Test
    fun `lines before the first hunk header are skipped`() {
        // Arrange
        val text = listOf("diff --git a/f b/f", "index abc..def 100644", "--- a/f", "+++ b/f").joinToString("\n")

        // Act
        val parsed = parseUnifiedDiff(text)

        // Assert
        assertEquals(emptyList(), parsed.hunks)
    }

    @Test
    fun `handles multiple hunks in one file`() {
        // Arrange
        val text = listOf(
            "@@ -1,1 +1,1 @@",
            "-a",
            "+b",
            "@@ -10,1 +10,1 @@",
            "-c",
            "+d",
        ).joinToString("\n")

        // Act
        val parsed = parseUnifiedDiff(text)

        // Assert
        assertEquals(2, parsed.hunks.size)
        assertEquals(2, parsed.additions)
        assertEquals(2, parsed.deletions)
    }

    @Test
    fun `keeps a trailing no-newline marker as a meta line`() {
        // Arrange
        val text = listOf("@@ -1,1 +1,1 @@", "-old", "\\ No newline at end of file", "+new").joinToString("\n")

        // Act
        val lines = parseUnifiedDiff(text).hunks.first().lines

        // Assert
        assertEquals(
            listOf(DiffRowType.DEL, DiffRowType.META, DiffRowType.ADD),
            lines.map { it.type },
        )
        assertNull(lines[1].oldLineNo)
        assertNull(lines[1].newLineNo)
    }

    @Test
    fun `empty diff text has no hunks`() {
        assertEquals(emptyList(), parseUnifiedDiff("").hunks)
    }

    @Test
    fun `parsedDiffFromAdditions renders every line as an addition starting at line 1`() {
        // Act
        val parsed = parsedDiffFromAdditions("first\nsecond")

        // Assert
        assertEquals(1, parsed.hunks.size)
        assertEquals(2, parsed.additions)
        assertEquals(0, parsed.deletions)
        val lines = parsed.hunks.first().lines
        assertEquals(listOf(DiffRowType.ADD, DiffRowType.ADD), lines.map { it.type })
        assertEquals(listOf(1, 2), lines.map { it.newLineNo })
        assertEquals(listOf(null, null), lines.map { it.oldLineNo })
    }

    @Test
    fun `parsedDiffFromAdditions on empty text produces no hunks`() {
        assertEquals(emptyList(), parsedDiffFromAdditions("").hunks)
    }

    @Test
    fun `computeLineWordDiff marks only the changed word as changed`() {
        // Act
        val result = computeLineWordDiff("const old = 1", "const updated = 1")

        // Assert
        assertEquals("const ", result.oldSegments.first().text)
        assertTrue(result.oldSegments.first().changed.not())
        assertTrue(result.oldSegments.any { it.changed && it.text == "old" })
        assertTrue(result.newSegments.any { it.changed && it.text == "updated" })
    }

    @Test
    fun `computeLineWordDiff on identical lines has no changed segments`() {
        // Act
        val result = computeLineWordDiff("same line", "same line")

        // Assert
        assertTrue(result.oldSegments.none { it.changed })
        assertTrue(result.newSegments.none { it.changed })
    }

    @Test
    fun `withIntralineHighlights pairs equal-length del-add runs and attaches segments`() {
        // Arrange
        val text = listOf("@@ -1,1 +1,1 @@", "-const old = 1", "+const updated = 1").joinToString("\n")

        // Act
        val hunk = withIntralineHighlights(parseUnifiedDiff(text)).hunks.first()

        // Assert
        val (del, add) = hunk.lines
        assertTrue(del.segments != null)
        assertTrue(add.segments != null)
        assertTrue(del.segments!!.any { it.changed && it.text == "old" })
        assertTrue(add.segments!!.any { it.changed && it.text == "updated" })
    }

    @Test
    fun `withIntralineHighlights leaves unequal-length del-add runs unpaired`() {
        // Arrange
        val text = listOf("@@ -1,2 +1,1 @@", "-line one", "-line two", "+only line").joinToString("\n")

        // Act
        val hunk = withIntralineHighlights(parseUnifiedDiff(text)).hunks.first()

        // Assert
        assertTrue(hunk.lines.all { it.segments == null })
    }
}
