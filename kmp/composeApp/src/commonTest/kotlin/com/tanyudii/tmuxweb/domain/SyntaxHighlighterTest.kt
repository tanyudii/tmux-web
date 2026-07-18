package com.tanyudii.tmuxweb.domain

import kotlin.test.Test
import kotlin.test.assertEquals

class SyntaxHighlighterTest {
    @Test
    fun `languageForFileName maps known extensions`() {
        assertEquals(SyntaxLanguage.KOTLIN, languageForFileName("Foo.kt"))
        assertEquals(SyntaxLanguage.KOTLIN, languageForFileName("build.gradle.kts"))
        assertEquals(SyntaxLanguage.TYPESCRIPT, languageForFileName("server.ts"))
        assertEquals(SyntaxLanguage.TYPESCRIPT, languageForFileName("App.tsx"))
        assertEquals(SyntaxLanguage.JAVASCRIPT, languageForFileName("index.js"))
        assertEquals(SyntaxLanguage.GO, languageForFileName("main.go"))
    }

    @Test
    fun `languageForFileName falls back to PLAIN for unknown or missing extensions`() {
        assertEquals(SyntaxLanguage.PLAIN, languageForFileName("README.md"))
        assertEquals(SyntaxLanguage.PLAIN, languageForFileName("Makefile"))
        assertEquals(SyntaxLanguage.PLAIN, languageForFileName("trailing."))
    }

    @Test
    fun `tokenizeLine returns the whole line as PLAIN for PLAIN language`() {
        val tokens = tokenizeLine("fun main() {}", SyntaxLanguage.PLAIN)
        assertEquals(listOf(SyntaxToken("fun main() {}", TokenKind.PLAIN)), tokens)
    }

    @Test
    fun `tokenizeLine recognizes Kotlin keywords`() {
        // The trailing space + "main" are both PLAIN and adjacent, so they merge into one token.
        val tokens = tokenizeLine("fun main", SyntaxLanguage.KOTLIN)
        assertEquals(
            listOf(
                SyntaxToken("fun", TokenKind.KEYWORD),
                SyntaxToken(" main", TokenKind.PLAIN),
            ),
            tokens,
        )
    }

    @Test
    fun `tokenizeLine recognizes double-quoted strings`() {
        val tokens = tokenizeLine("""val x = "hello"""", SyntaxLanguage.KOTLIN)
        assertEquals(SyntaxToken("\"hello\"", TokenKind.STRING), tokens.last())
    }

    @Test
    fun `tokenizeLine handles an escaped quote inside a string without ending early`() {
        val tokens = tokenizeLine("""val x = "a\"b"""", SyntaxLanguage.KOTLIN)
        assertEquals(SyntaxToken("\"a\\\"b\"", TokenKind.STRING), tokens.last())
    }

    @Test
    fun `tokenizeLine recognizes line comments and stops tokenizing after them`() {
        val tokens = tokenizeLine("val x = 1 // set x", SyntaxLanguage.TYPESCRIPT)
        assertEquals(TokenKind.COMMENT, tokens.last().kind)
        assertEquals("// set x", tokens.last().text)
    }

    @Test
    fun `tokenizeLine recognizes integer and decimal numbers`() {
        val tokens = tokenizeLine("const x = 42", SyntaxLanguage.TYPESCRIPT)
        assertEquals(SyntaxToken("42", TokenKind.NUMBER), tokens.last())

        val decimalTokens = tokenizeLine("const y = 3.14", SyntaxLanguage.TYPESCRIPT)
        assertEquals(SyntaxToken("3.14", TokenKind.NUMBER), decimalTokens.last())
    }

    @Test
    fun `tokenizeLine does not misclassify identifiers containing keyword substrings`() {
        // "for" is a keyword, but "formatter" (word-boundary matched, not substring matched)
        // must never be classified as KEYWORD -- it ends up folded into a merged PLAIN run.
        val tokens = tokenizeLine("val formatter = 1", SyntaxLanguage.KOTLIN)
        assertEquals(false, tokens.any { it.kind == TokenKind.KEYWORD && it.text != "val" })
        assertEquals(true, tokens.any { it.kind == TokenKind.PLAIN && it.text.contains("formatter") })
    }

    @Test
    fun `tokenizeLine merges adjacent plain punctuation into one token`() {
        val tokens = tokenizeLine("go func()", SyntaxLanguage.GO)
        assertEquals(
            listOf(
                SyntaxToken("go", TokenKind.KEYWORD),
                SyntaxToken(" ", TokenKind.PLAIN),
                SyntaxToken("func", TokenKind.KEYWORD),
                SyntaxToken("()", TokenKind.PLAIN),
            ),
            tokens,
        )
    }

    @Test
    fun `tokenizeLine handles an empty line`() {
        assertEquals(listOf(SyntaxToken("", TokenKind.PLAIN)), tokenizeLine("", SyntaxLanguage.KOTLIN))
    }
}
