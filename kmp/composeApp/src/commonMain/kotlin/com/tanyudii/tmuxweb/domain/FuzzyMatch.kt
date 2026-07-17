package com.tanyudii.tmuxweb.domain

/**
 * Minimal fuzzy matcher for the command palette (EMB-218) -- a target
 * matches if every character of [query] appears in [target], in order,
 * case-insensitively (a classic "fuzzy finder" subsequence match, the same
 * algorithm behind fzf/Sublime's Goto Anything). An empty query always
 * matches, so an empty search box shows every item rather than none.
 */
fun fuzzyMatches(query: String, target: String): Boolean {
    if (query.isEmpty()) return true
    val lowerTarget = target.lowercase()
    val lowerQuery = query.lowercase()
    var targetIndex = 0
    for (queryChar in lowerQuery) {
        var found = false
        while (targetIndex < lowerTarget.length) {
            if (lowerTarget[targetIndex] == queryChar) {
                found = true
                targetIndex++
                break
            }
            targetIndex++
        }
        if (!found) return false
    }
    return true
}

/**
 * Lower is a better match -- an exact substring match ranks above a
 * scattered subsequence match, so typing a project/session's real name
 * verbatim always sorts it to the top instead of leaving ranking purely to
 * list order. Only meaningful to call on targets that already
 * [fuzzyMatches] the query.
 */
fun fuzzyMatchRank(query: String, target: String): Int {
    if (query.isEmpty()) return Int.MAX_VALUE
    val lowerTarget = target.lowercase()
    val lowerQuery = query.lowercase()
    val substringIndex = lowerTarget.indexOf(lowerQuery)
    // Exact substring matches rank by how early they start (a prefix match
    // beats a match buried mid-string); anything else (scattered
    // subsequence-only matches) ranks after every substring match.
    return if (substringIndex >= 0) substringIndex else Int.MAX_VALUE - 1
}
