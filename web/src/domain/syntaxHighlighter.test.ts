import { describe, expect, test } from "vitest";
import { languageForFileName, tokenizeLine } from "./syntaxHighlighter";

// Ports kmp/.../domain/SyntaxHighlighterTest.kt 1:1.
describe("languageForFileName", () => {
  test("maps known extensions", () => {
    expect(languageForFileName("Foo.kt")).toBe("kotlin");
    expect(languageForFileName("build.gradle.kts")).toBe("kotlin");
    expect(languageForFileName("server.ts")).toBe("typescript");
    expect(languageForFileName("App.tsx")).toBe("typescript");
    expect(languageForFileName("index.js")).toBe("javascript");
    expect(languageForFileName("main.go")).toBe("go");
  });

  test("falls back to plain for unknown or missing extensions", () => {
    expect(languageForFileName("README.md")).toBe("plain");
    expect(languageForFileName("Makefile")).toBe("plain");
    expect(languageForFileName("trailing.")).toBe("plain");
  });
});

describe("tokenizeLine", () => {
  test("returns the whole line as plain for plain language", () => {
    const tokens = tokenizeLine("fun main() {}", "plain");

    expect(tokens).toEqual([{ text: "fun main() {}", kind: "plain" }]);
  });

  test("recognizes Kotlin keywords", () => {
    // The trailing space + "main" are both plain and adjacent, so they merge into one token.
    const tokens = tokenizeLine("fun main", "kotlin");

    expect(tokens).toEqual([
      { text: "fun", kind: "keyword" },
      { text: " main", kind: "plain" },
    ]);
  });

  test("recognizes double-quoted strings", () => {
    const tokens = tokenizeLine('val x = "hello"', "kotlin");

    expect(tokens.at(-1)).toEqual({ text: '"hello"', kind: "string" });
  });

  test("handles an escaped quote inside a string without ending early", () => {
    const tokens = tokenizeLine('val x = "a\\"b"', "kotlin");

    expect(tokens.at(-1)).toEqual({ text: '"a\\"b"', kind: "string" });
  });

  test("recognizes line comments and stops tokenizing after them", () => {
    const tokens = tokenizeLine("val x = 1 // set x", "typescript");

    expect(tokens.at(-1)).toEqual({ text: "// set x", kind: "comment" });
  });

  test("recognizes integer and decimal numbers", () => {
    const tokens = tokenizeLine("const x = 42", "typescript");
    expect(tokens.at(-1)).toEqual({ text: "42", kind: "number" });

    const decimalTokens = tokenizeLine("const y = 3.14", "typescript");
    expect(decimalTokens.at(-1)).toEqual({ text: "3.14", kind: "number" });
  });

  test("does not misclassify identifiers containing keyword substrings", () => {
    // "for" is a keyword, but "formatter" (word-boundary matched, not substring matched)
    // must never be classified as keyword -- it ends up folded into a merged plain run.
    const tokens = tokenizeLine("val formatter = 1", "kotlin");

    expect(tokens.some((token) => token.kind === "keyword" && token.text !== "val")).toBe(false);
    expect(tokens.some((token) => token.kind === "plain" && token.text.includes("formatter"))).toBe(true);
  });

  test("merges adjacent plain punctuation into one token", () => {
    const tokens = tokenizeLine("go func()", "go");

    expect(tokens).toEqual([
      { text: "go", kind: "keyword" },
      { text: " ", kind: "plain" },
      { text: "func", kind: "keyword" },
      { text: "()", kind: "plain" },
    ]);
  });

  test("handles an empty line", () => {
    expect(tokenizeLine("", "kotlin")).toEqual([{ text: "", kind: "plain" }]);
  });
});
