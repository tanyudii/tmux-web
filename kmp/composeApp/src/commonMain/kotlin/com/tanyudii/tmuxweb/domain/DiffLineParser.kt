package com.tanyudii.tmuxweb.domain

enum class DiffLineKind {
    FILE_HEADER,
    HUNK,
    ADDITION,
    DELETION,
    CONTEXT,
}

data class DiffLine(val id: Int, val text: String, val kind: DiffLineKind)

/**
 * Mirrors `renderDiffLines` in public/app.js and DiffDetailView.swift's
 * `parseDiffLines`: color file headers (`+++`/`---`), hunks (`@@`),
 * additions (`+`), deletions (`-`), and everything else as context.
 */
fun parseDiffLines(diffText: String): List<DiffLine> =
    diffText.split("\n").mapIndexed { index, line ->
        val kind = when {
            line.startsWith("+++") || line.startsWith("---") -> DiffLineKind.FILE_HEADER
            line.startsWith("@@") -> DiffLineKind.HUNK
            line.startsWith("+") -> DiffLineKind.ADDITION
            line.startsWith("-") -> DiffLineKind.DELETION
            else -> DiffLineKind.CONTEXT
        }
        DiffLine(id = index, text = line, kind = kind)
    }

/**
 * Mirrors `openDiffFor`'s untracked-file handling in public/app.js: an
 * untracked file has no real diff, so every line is rendered as an addition.
 */
fun asAllAdditions(text: String): String =
    text.split("\n").joinToString("\n") { "+$it" }
