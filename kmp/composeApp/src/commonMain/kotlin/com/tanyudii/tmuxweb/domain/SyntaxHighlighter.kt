package com.tanyudii.tmuxweb.domain

/** Languages with curated keyword lists for [tokenizeLine] -- see EMB-206. */
enum class SyntaxLanguage { KOTLIN, TYPESCRIPT, JAVASCRIPT, GO, PLAIN }

enum class TokenKind { KEYWORD, STRING, COMMENT, NUMBER, PLAIN }

data class SyntaxToken(val text: String, val kind: TokenKind)

private val EXTENSION_LANGUAGE = mapOf(
    "kt" to SyntaxLanguage.KOTLIN,
    "kts" to SyntaxLanguage.KOTLIN,
    "ts" to SyntaxLanguage.TYPESCRIPT,
    "tsx" to SyntaxLanguage.TYPESCRIPT,
    "mts" to SyntaxLanguage.TYPESCRIPT,
    "js" to SyntaxLanguage.JAVASCRIPT,
    "jsx" to SyntaxLanguage.JAVASCRIPT,
    "mjs" to SyntaxLanguage.JAVASCRIPT,
    "cjs" to SyntaxLanguage.JAVASCRIPT,
    "go" to SyntaxLanguage.GO,
)

/** Falls back to [SyntaxLanguage.PLAIN] for unrecognized/missing extensions -- [tokenizeLine] then no-ops. */
fun languageForFileName(fileName: String): SyntaxLanguage {
    val dotIndex = fileName.lastIndexOf('.')
    if (dotIndex < 0 || dotIndex == fileName.length - 1) return SyntaxLanguage.PLAIN
    return EXTENSION_LANGUAGE[fileName.substring(dotIndex + 1).lowercase()] ?: SyntaxLanguage.PLAIN
}

// Intentionally small, curated sets -- not exhaustive language grammars.
// Covers the languages this project's own source is written in (see
// EMB-206's ticket scope: "cover the languages the user's project
// predominantly uses" -- for tmux-web itself that's Kotlin and TypeScript).
private val KEYWORDS: Map<SyntaxLanguage, Set<String>> = mapOf(
    SyntaxLanguage.KOTLIN to setOf(
        "fun", "val", "var", "class", "object", "interface", "if", "else", "when", "for", "while", "do",
        "return", "import", "package", "private", "public", "internal", "protected", "override", "companion",
        "is", "as", "in", "null", "true", "false", "this", "super", "try", "catch", "finally", "throw",
        "suspend", "data", "sealed", "enum", "typealias", "constructor", "init", "by", "lateinit", "const",
        "vararg", "inline", "reified", "operator", "infix", "annotation", "actual", "expect",
    ),
    SyntaxLanguage.TYPESCRIPT to setOf(
        "function", "const", "let", "var", "class", "interface", "type", "if", "else", "switch", "case",
        "for", "while", "do", "return", "import", "export", "from", "default", "private", "public", "protected",
        "readonly", "static", "extends", "implements", "new", "this", "super", "try", "catch", "finally",
        "throw", "async", "await", "null", "undefined", "true", "false", "typeof", "instanceof", "as",
        "enum", "namespace", "declare", "abstract", "void", "in", "of", "yield",
    ),
    SyntaxLanguage.JAVASCRIPT to setOf(
        "function", "const", "let", "var", "class", "if", "else", "switch", "case", "for", "while", "do",
        "return", "import", "export", "from", "default", "extends", "new", "this", "super", "try", "catch",
        "finally", "throw", "async", "await", "null", "undefined", "true", "false", "typeof", "instanceof",
        "in", "of", "yield",
    ),
    SyntaxLanguage.GO to setOf(
        "func", "var", "const", "type", "struct", "interface", "if", "else", "switch", "case", "for", "range",
        "return", "import", "package", "go", "chan", "select", "defer", "map", "nil", "true", "false", "break",
        "continue", "fallthrough", "default", "goto",
    ),
)

private val WORD_PATTERN = Regex("""[A-Za-z_][A-Za-z0-9_]*""")

/**
 * Splits one diff line into colorable tokens. Deliberately single-line and
 * stateless -- a diff hunk view has no cross-line context (a hunk can start
 * or end mid-way through a multi-line block comment/string with no
 * indication in the line itself), so a real lexer's carry-over state isn't
 * available here. A line inside a `/* ... */` block simply won't be
 * recognized as a comment; line comments, single-line strings, keywords,
 * and numbers -- the common case -- are still highlighted correctly.
 */
fun tokenizeLine(line: String, language: SyntaxLanguage): List<SyntaxToken> {
    if (language == SyntaxLanguage.PLAIN || line.isEmpty()) return listOf(SyntaxToken(line, TokenKind.PLAIN))

    val keywords = KEYWORDS[language].orEmpty()
    val tokens = mutableListOf<SyntaxToken>()
    var i = 0
    while (i < line.length) {
        val c = line[i]
        when {
            c == '/' && i + 1 < line.length && line[i + 1] == '/' -> {
                tokens.add(SyntaxToken(line.substring(i), TokenKind.COMMENT))
                i = line.length
            }
            c == '"' || c == '\'' || c == '`' -> {
                val end = findStringEnd(line, i + 1, c)
                tokens.add(SyntaxToken(line.substring(i, end), TokenKind.STRING))
                i = end
            }
            c.isDigit() -> {
                var j = i
                while (j < line.length && (line[j].isDigit() || line[j] == '.')) j++
                tokens.add(SyntaxToken(line.substring(i, j), TokenKind.NUMBER))
                i = j
            }
            c.isLetter() || c == '_' -> {
                val word = WORD_PATTERN.matchAt(line, i)?.value ?: c.toString()
                tokens.add(SyntaxToken(word, if (word in keywords) TokenKind.KEYWORD else TokenKind.PLAIN))
                i += word.length
            }
            else -> {
                tokens.add(SyntaxToken(c.toString(), TokenKind.PLAIN))
                i++
            }
        }
    }
    return mergeAdjacentPlain(tokens)
}

private fun findStringEnd(line: String, start: Int, quote: Char): Int {
    var j = start
    while (j < line.length) {
        if (line[j] == '\\' && j + 1 < line.length) {
            j += 2
            continue
        }
        if (line[j] == quote) return j + 1
        j++
    }
    return line.length
}

// Character-by-character tokenizing emits one PLAIN token per punctuation/
// whitespace character -- merge runs of them so the caller (and any
// snapshot test) sees "  return " once, not five single-char tokens.
private fun mergeAdjacentPlain(tokens: List<SyntaxToken>): List<SyntaxToken> {
    if (tokens.isEmpty()) return tokens
    val merged = mutableListOf<SyntaxToken>()
    for (token in tokens) {
        val last = merged.lastOrNull()
        if (last != null && last.kind == TokenKind.PLAIN && token.kind == TokenKind.PLAIN) {
            merged[merged.size - 1] = SyntaxToken(last.text + token.text, TokenKind.PLAIN)
        } else {
            merged.add(token)
        }
    }
    return merged
}
