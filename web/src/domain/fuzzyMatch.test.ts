import { describe, expect, test } from "vitest";
import { fuzzyMatchRank, fuzzyMatches } from "./fuzzyMatch";

// Ports kmp/.../domain/FuzzyMatchTest.kt 1:1.
describe("fuzzyMatches", () => {
  test("empty query matches everything", () => {
    expect(fuzzyMatches("", "anything")).toBe(true);
    expect(fuzzyMatches("", "")).toBe(true);
  });

  test("exact substring matches", () => {
    expect(fuzzyMatches("feat", "feature-x")).toBe(true);
  });

  test("case insensitive", () => {
    expect(fuzzyMatches("FEAT", "feature-x")).toBe(true);
    expect(fuzzyMatches("feat", "FEATURE-X")).toBe(true);
  });

  test("scattered subsequence matches in order", () => {
    expect(fuzzyMatches("ftx", "feature-x")).toBe(true);
  });

  test("characters out of order do not match", () => {
    expect(fuzzyMatches("xtf", "feature-x")).toBe(false);
  });

  test("query longer than target never matches", () => {
    expect(fuzzyMatches("feature-extended", "feat")).toBe(false);
  });

  test("unrelated query does not match", () => {
    expect(fuzzyMatches("zzz", "feature-x")).toBe(false);
  });
});

describe("fuzzyMatchRank", () => {
  test("rank favors an earlier substring match", () => {
    const prefixRank = fuzzyMatchRank("feat", "feature-x");
    const midRank = fuzzyMatchRank("feat", "my-feature-x");

    expect(prefixRank).toBeLessThan(midRank);
  });

  test("rank of a pure subsequence match is worse than any substring match", () => {
    const substringRank = fuzzyMatchRank("feat", "my-feature-x");
    const subsequenceRank = fuzzyMatchRank("ftx", "feature-x");

    expect(subsequenceRank).toBeGreaterThan(substringRank);
  });

  test("empty query ranks highest of all", () => {
    expect(fuzzyMatchRank("", "anything")).toBe(Number.MAX_SAFE_INTEGER);
  });
});
