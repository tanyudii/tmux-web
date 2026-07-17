package com.tanyudii.tmuxweb.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FuzzyMatchTest {
    @Test
    fun `empty query matches everything`() {
        assertTrue(fuzzyMatches("", "anything"))
        assertTrue(fuzzyMatches("", ""))
    }

    @Test
    fun `exact substring matches`() {
        assertTrue(fuzzyMatches("feat", "feature-x"))
    }

    @Test
    fun `case insensitive`() {
        assertTrue(fuzzyMatches("FEAT", "feature-x"))
        assertTrue(fuzzyMatches("feat", "FEATURE-X"))
    }

    @Test
    fun `scattered subsequence matches in order`() {
        assertTrue(fuzzyMatches("ftx", "feature-x"))
    }

    @Test
    fun `characters out of order do not match`() {
        assertFalse(fuzzyMatches("xtf", "feature-x"))
    }

    @Test
    fun `query longer than target never matches`() {
        assertFalse(fuzzyMatches("feature-extended", "feat"))
    }

    @Test
    fun `unrelated query does not match`() {
        assertFalse(fuzzyMatches("zzz", "feature-x"))
    }

    @Test
    fun `rank favors an earlier substring match`() {
        val prefixRank = fuzzyMatchRank("feat", "feature-x")
        val midRank = fuzzyMatchRank("feat", "my-feature-x")
        assertTrue(prefixRank < midRank)
    }

    @Test
    fun `rank of a pure subsequence match is worse than any substring match`() {
        val substringRank = fuzzyMatchRank("feat", "my-feature-x")
        val subsequenceRank = fuzzyMatchRank("ftx", "feature-x")
        assertTrue(subsequenceRank > substringRank)
    }

    @Test
    fun `empty query ranks highest of all`() {
        assertEquals(Int.MAX_VALUE, fuzzyMatchRank("", "anything"))
    }
}
