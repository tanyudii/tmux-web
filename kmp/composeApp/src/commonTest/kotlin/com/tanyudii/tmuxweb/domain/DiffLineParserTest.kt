package com.tanyudii.tmuxweb.domain

import kotlin.test.Test
import kotlin.test.assertEquals

/** Ports ios/TmuxWebClientTests/DiffDetailViewTests.swift 1:1. */
class DiffLineParserTest {
    @Test
    fun `classifies each diff line kind`() {
        // Arrange
        val text = listOf(
            "--- a/file.txt",
            "+++ b/file.txt",
            "@@ -1,2 +1,2 @@",
            "-old line",
            "+new line",
            " unchanged line",
        ).joinToString("\n")

        // Act
        val lines = parseDiffLines(text)

        // Assert
        assertEquals(
            listOf(
                DiffLineKind.FILE_HEADER,
                DiffLineKind.FILE_HEADER,
                DiffLineKind.HUNK,
                DiffLineKind.DELETION,
                DiffLineKind.ADDITION,
                DiffLineKind.CONTEXT,
            ),
            lines.map { it.kind },
        )
    }

    @Test
    fun `empty line is context`() {
        assertEquals(listOf(DiffLineKind.CONTEXT), parseDiffLines("").map { it.kind })
    }

    @Test
    fun `asAllAdditions prefixes every line with plus`() {
        assertEquals("+a\n+b", asAllAdditions("a\nb"))
    }
}
