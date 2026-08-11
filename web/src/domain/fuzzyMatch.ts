// Ports kmp/composeApp/.../domain/FuzzyMatch.kt -- minimal fuzzy matcher for
// the command palette (EMB-218): a target matches if every character of
// `query` appears in `target`, in order, case-insensitively (the classic
// "fuzzy finder" subsequence match behind fzf/Sublime's Goto Anything). An
// empty query always matches, so an empty search box shows every item.
export function fuzzyMatches(query: string, target: string): boolean {
  if (query.length === 0) return true;
  const lowerTarget = target.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let targetIndex = 0;
  for (const queryChar of lowerQuery) {
    let found = false;
    while (targetIndex < lowerTarget.length) {
      if (lowerTarget[targetIndex] === queryChar) {
        found = true;
        targetIndex++;
        break;
      }
      targetIndex++;
    }
    if (!found) return false;
  }
  return true;
}

/**
 * Lower is a better match -- an exact substring match ranks above a
 * scattered subsequence match, so typing a project/session's real name
 * verbatim always sorts it to the top. Only meaningful to call on targets
 * that already `fuzzyMatches` the query.
 */
export function fuzzyMatchRank(query: string, target: string): number {
  if (query.length === 0) return Number.MAX_SAFE_INTEGER;
  const lowerTarget = target.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const substringIndex = lowerTarget.indexOf(lowerQuery);
  // Exact substring matches rank by how early they start (a prefix match
  // beats a match buried mid-string); anything else (scattered
  // subsequence-only matches) ranks after every substring match.
  return substringIndex >= 0 ? substringIndex : Number.MAX_SAFE_INTEGER - 1;
}
