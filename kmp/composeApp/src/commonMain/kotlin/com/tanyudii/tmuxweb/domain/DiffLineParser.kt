package com.tanyudii.tmuxweb.domain

private val HUNK_HEADER_PATTERN = Regex("""^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@""")
private const val GROUP_OLD_START = 1
private const val GROUP_OLD_LINES = 2
private const val GROUP_NEW_START = 3
private const val GROUP_NEW_LINES = 4

/** One row in a rendered diff hunk. `oldLineNo`/`newLineNo` are null where that side has no line (add/del/meta). */
enum class DiffRowType { ADD, DEL, CONTEXT, META }

data class DiffSegment(val text: String, val changed: Boolean)

data class DiffRow(
    val type: DiffRowType,
    val oldLineNo: Int?,
    val newLineNo: Int?,
    val content: String,
    val segments: List<DiffSegment>? = null,
)

data class DiffHunk(
    val header: String,
    val oldStart: Int,
    val oldLines: Int,
    val newStart: Int,
    val newLines: Int,
    val lines: List<DiffRow>,
)

data class ParsedDiff(val hunks: List<DiffHunk>, val additions: Int, val deletions: Int)

private fun splitDiffLines(text: String): List<String> {
    if (text.isEmpty()) return emptyList()
    val lines = text.split("\n").toMutableList()
    if (lines.isNotEmpty() && lines.last().isEmpty()) lines.removeAt(lines.size - 1)
    return lines
}

/**
 * Parses raw `git diff` output for a single file into hunks with per-line
 * old/new line numbers. Lines before the first `@@` header (`diff --git`,
 * `index`, `---`, `+++`, rename/mode lines) are noise the caller doesn't
 * need -- the file path is already shown by the tree row -- so they're
 * skipped rather than represented. Ports `parseUnifiedDiff` from
 * public/diff-parser.js (see commit 94514e6, removed in 2d3b55c's cutover).
 */
private class UnifiedDiffBuilder {
    private val hunks = mutableListOf<DiffHunk>()
    private var header: String? = null
    private var oldStart = 0
    private var oldLines = 0
    private var newStart = 0
    private var newLines = 0
    private var lines = mutableListOf<DiffRow>()
    private var oldLineNo = 0
    private var newLineNo = 0
    private var additions = 0
    private var deletions = 0

    val isInsideHunk: Boolean get() = header != null

    fun startHunk(rawLine: String, match: MatchResult) {
        flushHunk()
        val groups = match.groupValues
        oldStart = groups[GROUP_OLD_START].toInt()
        newStart = groups[GROUP_NEW_START].toInt()
        oldLines = groups[GROUP_OLD_LINES].ifEmpty { "1" }.toInt()
        newLines = groups[GROUP_NEW_LINES].ifEmpty { "1" }.toInt()
        header = rawLine
        lines = mutableListOf()
        oldLineNo = oldStart
        newLineNo = newStart
    }

    fun addMeta(rawLine: String) {
        lines.add(DiffRow(DiffRowType.META, null, null, rawLine))
    }

    fun addContentLine(rawLine: String) {
        when (val marker = rawLine.firstOrNull()) {
            '+' -> {
                lines.add(DiffRow(DiffRowType.ADD, null, newLineNo, rawLine.substring(1)))
                newLineNo++
                additions++
            }
            '-' -> {
                lines.add(DiffRow(DiffRowType.DEL, oldLineNo, null, rawLine.substring(1)))
                oldLineNo++
                deletions++
            }
            else -> {
                val content = if (marker == ' ') rawLine.substring(1) else rawLine
                lines.add(DiffRow(DiffRowType.CONTEXT, oldLineNo, newLineNo, content))
                oldLineNo++
                newLineNo++
            }
        }
    }

    fun flushHunk() {
        val currentHeader = header ?: return
        hunks.add(DiffHunk(currentHeader, oldStart, oldLines, newStart, newLines, lines))
    }

    fun build(): ParsedDiff {
        flushHunk()
        return ParsedDiff(hunks, additions, deletions)
    }
}

fun parseUnifiedDiff(diffText: String): ParsedDiff {
    val builder = UnifiedDiffBuilder()
    for (rawLine in splitDiffLines(diffText)) {
        val headerMatch = HUNK_HEADER_PATTERN.find(rawLine)
        when {
            headerMatch != null -> builder.startHunk(rawLine, headerMatch)
            !builder.isInsideHunk -> Unit
            rawLine.startsWith("\\") -> builder.addMeta(rawLine)
            else -> builder.addContentLine(rawLine)
        }
    }
    return builder.build()
}

/**
 * Builds a synthetic single-hunk diff for an untracked file: there is no
 * real diff to show, so every line of its content is rendered as an
 * addition, same as how GitHub treats a brand-new file.
 */
fun parsedDiffFromAdditions(text: String): ParsedDiff {
    val lines = splitDiffLines(text)
    if (lines.isEmpty()) return ParsedDiff(emptyList(), 0, 0)

    val hunkLines = lines.mapIndexed { index, content -> DiffRow(DiffRowType.ADD, null, index + 1, content) }
    val hunk = DiffHunk(
        header = "@@ -0,0 +1,${lines.size} @@",
        oldStart = 0,
        oldLines = 0,
        newStart = 1,
        newLines = lines.size,
        lines = hunkLines,
    )
    return ParsedDiff(listOf(hunk), lines.size, 0)
}

data class LineWordDiff(val oldSegments: List<DiffSegment>, val newSegments: List<DiffSegment>)

private val TOKEN_PATTERN = Regex("""[A-Za-z0-9_]+|[^A-Za-z0-9_]+""")

private fun tokenize(line: String): List<String> = TOKEN_PATTERN.findAll(line).map { it.value }.toList()

private sealed interface TokenOp {
    val token: String
    data class Equal(override val token: String) : TokenOp
    data class Delete(override val token: String) : TokenOp
    data class Insert(override val token: String) : TokenOp
}

/** Standard O(n*m) LCS over two token arrays, backtracked into a sequence of equal/delete/insert ops. */
private fun diffTokenOps(oldTokens: List<String>, newTokens: List<String>): List<TokenOp> {
    val n = oldTokens.size
    val m = newTokens.size
    val table = Array(n + 1) { IntArray(m + 1) }
    for (i in n - 1 downTo 0) {
        for (j in m - 1 downTo 0) {
            table[i][j] = if (oldTokens[i] == newTokens[j]) {
                table[i + 1][j + 1] + 1
            } else {
                maxOf(table[i + 1][j], table[i][j + 1])
            }
        }
    }

    val ops = mutableListOf<TokenOp>()
    var i = 0
    var j = 0
    while (i < n && j < m) {
        when {
            oldTokens[i] == newTokens[j] -> {
                ops.add(TokenOp.Equal(oldTokens[i]))
                i++
                j++
            }
            table[i + 1][j] >= table[i][j + 1] -> {
                ops.add(TokenOp.Delete(oldTokens[i]))
                i++
            }
            else -> {
                ops.add(TokenOp.Insert(newTokens[j]))
                j++
            }
        }
    }
    while (i < n) ops.add(TokenOp.Delete(oldTokens[i++]))
    while (j < m) ops.add(TokenOp.Insert(newTokens[j++]))
    return ops
}

/** Collapses ops into merged segments, keeping "equal" ops plus whichever changed-side op the caller asks for. */
private fun buildSegments(ops: List<TokenOp>, keepInsert: Boolean): List<DiffSegment> {
    val relevant = ops.mapNotNull { op ->
        when (op) {
            is TokenOp.Equal -> op.token to false
            is TokenOp.Insert -> if (keepInsert) op.token to true else null
            is TokenOp.Delete -> if (!keepInsert) op.token to true else null
        }
    }

    val segments = mutableListOf<DiffSegment>()
    for ((text, changed) in relevant) {
        val last = segments.lastOrNull()
        if (last != null && last.changed == changed) {
            segments[segments.size - 1] = last.copy(text = last.text + text)
        } else {
            segments.add(DiffSegment(text, changed))
        }
    }
    return segments
}

/**
 * Word-level (intraline) diff between a removed line and its replacement,
 * mirroring GitHub's highlight of the exact characters that changed within
 * a modified line pair, instead of just coloring the whole line.
 */
fun computeLineWordDiff(oldLine: String, newLine: String): LineWordDiff {
    val ops = diffTokenOps(tokenize(oldLine), tokenize(newLine))
    return LineWordDiff(
        oldSegments = buildSegments(ops, keepInsert = false),
        newSegments = buildSegments(ops, keepInsert = true),
    )
}

private class Run(val items: List<DiffRow>, val trailingMeta: DiffRow?, val end: Int)

/**
 * Scans a run of consecutive `type` lines starting at `start`, plus a
 * single trailing "\ No newline at end of file" meta line if one directly
 * follows -- git emits at most one such marker, right after the last line
 * of old/new content it describes.
 */
private fun scanRun(lines: List<DiffRow>, start: Int, type: DiffRowType): Run {
    var end = start
    while (end < lines.size && lines[end].type == type) end++
    val items = lines.subList(start, end)
    val trailingMeta = lines.getOrNull(end)?.takeIf { it.type == DiffRowType.META }
    val newEnd = if (trailingMeta != null) end + 1 else end
    return Run(items, trailingMeta, newEnd)
}

/**
 * Pairs up equal-length runs of consecutive del/add lines within each hunk
 * and attaches word-diff `segments` to each paired line, without disturbing
 * their original del-then-add display order. Runs whose del and add counts
 * don't match are left as plain add/del lines -- pairing them positionally
 * would highlight unrelated lines against each other.
 */
private fun annotateHunkLines(lines: List<DiffRow>): List<DiffRow> {
    val result = mutableListOf<DiffRow>()
    var i = 0
    while (i < lines.size) {
        if (lines[i].type != DiffRowType.DEL) {
            result.add(lines[i])
            i++
            continue
        }

        val delRun = scanRun(lines, i, DiffRowType.DEL)
        val addRun = scanRun(lines, delRun.end, DiffRowType.ADD)

        if (delRun.items.size == addRun.items.size) {
            val wordDiffs = delRun.items.mapIndexed { k, delLine ->
                computeLineWordDiff(delLine.content, addRun.items[k].content)
            }
            result.addAll(delRun.items.mapIndexed { k, delLine -> delLine.copy(segments = wordDiffs[k].oldSegments) })
            delRun.trailingMeta?.let(result::add)
            result.addAll(addRun.items.mapIndexed { k, addLine -> addLine.copy(segments = wordDiffs[k].newSegments) })
            addRun.trailingMeta?.let(result::add)
        } else {
            for (k in i until addRun.end) result.add(lines[k])
        }

        i = addRun.end
    }
    return result
}

fun withIntralineHighlights(parsedDiff: ParsedDiff): ParsedDiff =
    parsedDiff.copy(hunks = parsedDiff.hunks.map { hunk -> hunk.copy(lines = annotateHunkLines(hunk.lines)) })
