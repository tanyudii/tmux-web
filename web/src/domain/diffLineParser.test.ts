import { describe, expect, test } from "vitest";
import {
  computeLineWordDiff,
  parsedDiffFromAdditions,
  parseUnifiedDiff,
  withIntralineHighlights,
} from "./diffLineParser";

// Ports kmp/.../domain/DiffLineParserTest.kt 1:1 (itself a port of
// public/diff-parser.test.js, see commit 94514e6 / removed in 2d3b55c).
describe("parseUnifiedDiff", () => {
  test("parses a single hunk with add and del and context lines", () => {
    // Arrange
    const text = [
      "diff --git a/file.txt b/file.txt",
      "index 111..222 100644",
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@ -1,3 +1,3 @@",
      " unchanged",
      "-old line",
      "+new line",
      " trailing",
    ].join("\n");

    // Act
    const parsed = parseUnifiedDiff(text);

    // Assert
    expect(parsed.hunks).toHaveLength(1);
    const hunk = parsed.hunks[0];
    expect(hunk.header).toBe("@@ -1,3 +1,3 @@");
    expect(parsed.additions).toBe(1);
    expect(parsed.deletions).toBe(1);
    expect(hunk.lines.map((line) => line.type)).toEqual(["context", "del", "add", "context"]);
  });

  test("numbers old and new lines independently across add-del", () => {
    // Arrange
    const text = ["@@ -5,2 +5,2 @@", " ctx", "-removed", "+added"].join("\n");

    // Act
    const lines = parseUnifiedDiff(text).hunks[0].lines;

    // Assert
    expect(lines.map((line) => line.oldLineNo)).toEqual([5, 6, null]);
    expect(lines.map((line) => line.newLineNo)).toEqual([5, null, 6]);
  });

  test("lines before the first hunk header are skipped", () => {
    // Arrange
    const text = ["diff --git a/f b/f", "index abc..def 100644", "--- a/f", "+++ b/f"].join("\n");

    // Act
    const parsed = parseUnifiedDiff(text);

    // Assert
    expect(parsed.hunks).toEqual([]);
  });

  test("handles multiple hunks in one file", () => {
    // Arrange
    const text = ["@@ -1,1 +1,1 @@", "-a", "+b", "@@ -10,1 +10,1 @@", "-c", "+d"].join("\n");

    // Act
    const parsed = parseUnifiedDiff(text);

    // Assert
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.additions).toBe(2);
    expect(parsed.deletions).toBe(2);
  });

  test("keeps a trailing no-newline marker as a meta line", () => {
    // Arrange
    const text = ["@@ -1,1 +1,1 @@", "-old", "\\ No newline at end of file", "+new"].join("\n");

    // Act
    const lines = parseUnifiedDiff(text).hunks[0].lines;

    // Assert
    expect(lines.map((line) => line.type)).toEqual(["del", "meta", "add"]);
    expect(lines[1].oldLineNo).toBeNull();
    expect(lines[1].newLineNo).toBeNull();
  });

  test("empty diff text has no hunks", () => {
    expect(parseUnifiedDiff("").hunks).toEqual([]);
  });
});

describe("parsedDiffFromAdditions", () => {
  test("renders every line as an addition starting at line 1", () => {
    // Act
    const parsed = parsedDiffFromAdditions("first\nsecond");

    // Assert
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.additions).toBe(2);
    expect(parsed.deletions).toBe(0);
    const lines = parsed.hunks[0].lines;
    expect(lines.map((line) => line.type)).toEqual(["add", "add"]);
    expect(lines.map((line) => line.newLineNo)).toEqual([1, 2]);
    expect(lines.map((line) => line.oldLineNo)).toEqual([null, null]);
  });

  test("on empty text produces no hunks", () => {
    expect(parsedDiffFromAdditions("").hunks).toEqual([]);
  });
});

describe("computeLineWordDiff", () => {
  test("marks only the changed word as changed", () => {
    // Act
    const result = computeLineWordDiff("const old = 1", "const updated = 1");

    // Assert
    expect(result.oldSegments[0].text).toBe("const ");
    expect(result.oldSegments[0].changed).toBe(false);
    expect(result.oldSegments.some((segment) => segment.changed && segment.text === "old")).toBe(true);
    expect(result.newSegments.some((segment) => segment.changed && segment.text === "updated")).toBe(true);
  });

  test("on identical lines has no changed segments", () => {
    // Act
    const result = computeLineWordDiff("same line", "same line");

    // Assert
    expect(result.oldSegments.every((segment) => !segment.changed)).toBe(true);
    expect(result.newSegments.every((segment) => !segment.changed)).toBe(true);
  });
});

describe("withIntralineHighlights", () => {
  test("pairs equal-length del-add runs and attaches segments", () => {
    // Arrange
    const text = ["@@ -1,1 +1,1 @@", "-const old = 1", "+const updated = 1"].join("\n");

    // Act
    const hunk = withIntralineHighlights(parseUnifiedDiff(text)).hunks[0];

    // Assert
    const [del, add] = hunk.lines;
    expect(del.segments).not.toBeNull();
    expect(add.segments).not.toBeNull();
    expect(del.segments?.some((segment) => segment.changed && segment.text === "old")).toBe(true);
    expect(add.segments?.some((segment) => segment.changed && segment.text === "updated")).toBe(true);
  });

  test("leaves unequal-length del-add runs unpaired", () => {
    // Arrange
    const text = ["@@ -1,2 +1,1 @@", "-line one", "-line two", "+only line"].join("\n");

    // Act
    const hunk = withIntralineHighlights(parseUnifiedDiff(text)).hunks[0];

    // Assert
    expect(hunk.lines.every((line) => line.segments == null)).toBe(true);
  });
});
