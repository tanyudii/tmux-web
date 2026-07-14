import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff, parsedDiffFromAdditions, computeLineWordDiff, withIntralineHighlights } from "./diff-parser.js";

test("parseUnifiedDiff assigns correct old/new line numbers to context, add, and del lines", () => {
  const diffText = [
    "diff --git a/foo.txt b/foo.txt",
    "index e69de29..4b825dc 100644",
    "--- a/foo.txt",
    "+++ b/foo.txt",
    "@@ -1,3 +1,3 @@",
    " line one",
    "-line two",
    "+line two changed",
    " line three",
    "",
  ].join("\n");

  const result = parseUnifiedDiff(diffText);

  assert.equal(result.hunks.length, 1);
  const hunk = result.hunks[0];
  assert.equal(hunk.oldStart, 1);
  assert.equal(hunk.oldLines, 3);
  assert.equal(hunk.newStart, 1);
  assert.equal(hunk.newLines, 3);
  assert.deepEqual(hunk.lines, [
    { type: "context", oldLineNo: 1, newLineNo: 1, content: "line one" },
    { type: "del", oldLineNo: 2, newLineNo: null, content: "line two" },
    { type: "add", oldLineNo: null, newLineNo: 2, content: "line two changed" },
    { type: "context", oldLineNo: 3, newLineNo: 3, content: "line three" },
  ]);
  assert.equal(result.additions, 1);
  assert.equal(result.deletions, 1);
});

test("parseUnifiedDiff restarts line counters at each hunk header", () => {
  const diffText = [
    "diff --git a/foo.txt b/foo.txt",
    "--- a/foo.txt",
    "+++ b/foo.txt",
    "@@ -1,2 +1,2 @@",
    " a",
    "-b",
    "+b2",
    "@@ -10,2 +10,3 @@",
    " x",
    "+y",
    " z",
    "",
  ].join("\n");

  const result = parseUnifiedDiff(diffText);

  assert.equal(result.hunks.length, 2);
  assert.equal(result.hunks[0].lines[0].oldLineNo, 1);
  assert.equal(result.hunks[1].oldStart, 10);
  assert.deepEqual(result.hunks[1].lines, [
    { type: "context", oldLineNo: 10, newLineNo: 10, content: "x" },
    { type: "add", oldLineNo: null, newLineNo: 11, content: "y" },
    { type: "context", oldLineNo: 11, newLineNo: 12, content: "z" },
  ]);
});

test("parseUnifiedDiff ignores file-level header lines before the first hunk", () => {
  const diffText = [
    "diff --git a/foo.txt b/foo.txt",
    "index e69de29..4b825dc 100644",
    "--- a/foo.txt",
    "+++ b/foo.txt",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  const result = parseUnifiedDiff(diffText);

  assert.equal(result.hunks.length, 1);
  assert.equal(result.hunks[0].lines.length, 2);
});

test("parseUnifiedDiff counts only deletions when a hunk removes lines without adding any", () => {
  const diffText = ["@@ -1,2 +0,0 @@", "-a", "-b", ""].join("\n");

  const result = parseUnifiedDiff(diffText);

  assert.equal(result.additions, 0);
  assert.equal(result.deletions, 2);
});

test("parseUnifiedDiff counts only additions when a hunk adds lines without removing any", () => {
  const diffText = ["@@ -0,0 +1,2 @@", "+a", "+b", ""].join("\n");

  const result = parseUnifiedDiff(diffText);

  assert.equal(result.additions, 2);
  assert.equal(result.deletions, 0);
});

test("parseUnifiedDiff keeps a 'No newline at end of file' marker as a meta line without affecting line numbers", () => {
  const diffText = [
    "@@ -1,1 +1,1 @@",
    "-old content",
    "\\ No newline at end of file",
    "+new content",
    "\\ No newline at end of file",
    "",
  ].join("\n");

  const result = parseUnifiedDiff(diffText);

  assert.deepEqual(result.hunks[0].lines, [
    { type: "del", oldLineNo: 1, newLineNo: null, content: "old content" },
    { type: "meta", oldLineNo: null, newLineNo: null, content: "\\ No newline at end of file" },
    { type: "add", oldLineNo: null, newLineNo: 1, content: "new content" },
    { type: "meta", oldLineNo: null, newLineNo: null, content: "\\ No newline at end of file" },
  ]);
  assert.equal(result.additions, 1);
  assert.equal(result.deletions, 1);
});

test("parseUnifiedDiff defaults a hunk's line count to 1 when the header omits it", () => {
  const diffText = ["@@ -5 +5,2 @@", " a", "+b", ""].join("\n");

  const result = parseUnifiedDiff(diffText);

  assert.equal(result.hunks[0].oldLines, 1);
  assert.equal(result.hunks[0].newLines, 2);
});

test("parseUnifiedDiff returns no hunks and zero counts for an empty diff string", () => {
  const result = parseUnifiedDiff("");

  assert.deepEqual(result, { hunks: [], additions: 0, deletions: 0 });
});

test("parsedDiffFromAdditions marks every line of file content as an addition starting from line 1", () => {
  const text = "line one\nline two\nline three\n";

  const result = parsedDiffFromAdditions(text);

  assert.equal(result.hunks.length, 1);
  const hunk = result.hunks[0];
  assert.equal(hunk.oldStart, 0);
  assert.equal(hunk.oldLines, 0);
  assert.equal(hunk.newStart, 1);
  assert.equal(hunk.newLines, 3);
  assert.deepEqual(hunk.lines, [
    { type: "add", oldLineNo: null, newLineNo: 1, content: "line one" },
    { type: "add", oldLineNo: null, newLineNo: 2, content: "line two" },
    { type: "add", oldLineNo: null, newLineNo: 3, content: "line three" },
  ]);
  assert.equal(result.additions, 3);
  assert.equal(result.deletions, 0);
});

test("parsedDiffFromAdditions handles file content without a trailing newline", () => {
  const result = parsedDiffFromAdditions("only line");

  assert.equal(result.hunks[0].lines.length, 1);
  assert.deepEqual(result.hunks[0].lines[0], { type: "add", oldLineNo: null, newLineNo: 1, content: "only line" });
});

test("parsedDiffFromAdditions returns no hunks and zero counts for empty file content", () => {
  const result = parsedDiffFromAdditions("");

  assert.deepEqual(result, { hunks: [], additions: 0, deletions: 0 });
});

test("computeLineWordDiff marks only the differing word as changed when a single word differs", () => {
  const oldLine = "foo bar baz";
  const newLine = "foo qux baz";

  const result = computeLineWordDiff(oldLine, newLine);

  assert.equal(result.oldSegments.map((s) => s.text).join(""), oldLine);
  assert.equal(result.newSegments.map((s) => s.text).join(""), newLine);
  assert.ok(result.oldSegments.some((s) => s.text === "bar" && s.changed === true));
  assert.ok(result.newSegments.some((s) => s.text === "qux" && s.changed === true));
  // Unchanged runs merge adjacent tokens (e.g. "foo" + the following space),
  // so check by substring rather than an exact single-token match.
  assert.ok(result.oldSegments.some((s) => s.changed === false && s.text.includes("foo")));
  assert.ok(result.newSegments.some((s) => s.changed === false && s.text.includes("baz")));
});

test("computeLineWordDiff marks the entire line as changed when lines share no common tokens", () => {
  const result = computeLineWordDiff("abc", "xyz123");

  assert.deepEqual(result.oldSegments, [{ text: "abc", changed: true }]);
  assert.deepEqual(result.newSegments, [{ text: "xyz123", changed: true }]);
});

test("computeLineWordDiff returns a single unchanged segment for identical lines", () => {
  const result = computeLineWordDiff("same line here", "same line here");

  assert.deepEqual(result.oldSegments, [{ text: "same line here", changed: false }]);
  assert.deepEqual(result.newSegments, [{ text: "same line here", changed: false }]);
});

test("computeLineWordDiff returns empty segments for two empty lines", () => {
  const result = computeLineWordDiff("", "");

  assert.deepEqual(result.oldSegments, []);
  assert.deepEqual(result.newSegments, []);
});

test("withIntralineHighlights attaches word-diff segments to a paired del/add line", () => {
  const parsedDiff = {
    hunks: [
      {
        header: "@@ -1,3 +1,3 @@",
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [
          { type: "context", oldLineNo: 1, newLineNo: 1, content: "start" },
          { type: "del", oldLineNo: 2, newLineNo: null, content: "foo bar" },
          { type: "add", oldLineNo: null, newLineNo: 2, content: "foo baz" },
          { type: "context", oldLineNo: 3, newLineNo: 3, content: "end" },
        ],
      },
    ],
    additions: 1,
    deletions: 1,
  };

  const result = withIntralineHighlights(parsedDiff);

  const [contextLine, delLine, addLine] = result.hunks[0].lines;
  assert.equal(contextLine.segments, undefined);
  assert.ok(delLine.segments.some((s) => s.text === "bar" && s.changed === true));
  assert.ok(addLine.segments.some((s) => s.text === "baz" && s.changed === true));
  // The input is not mutated -- a fresh object is returned.
  assert.equal(parsedDiff.hunks[0].lines[1].segments, undefined);
});

test("withIntralineHighlights preserves the original del-then-add order for multi-line modified blocks", () => {
  const parsedDiff = {
    hunks: [
      {
        header: "@@ -1,2 +1,2 @@",
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [
          { type: "del", oldLineNo: 1, newLineNo: null, content: "one" },
          { type: "del", oldLineNo: 2, newLineNo: null, content: "two" },
          { type: "add", oldLineNo: null, newLineNo: 1, content: "uno" },
          { type: "add", oldLineNo: null, newLineNo: 2, content: "dos" },
        ],
      },
    ],
    additions: 2,
    deletions: 2,
  };

  const result = withIntralineHighlights(parsedDiff);

  assert.deepEqual(
    result.hunks[0].lines.map((l) => l.content),
    ["one", "two", "uno", "dos"],
  );
  assert.ok(result.hunks[0].lines.every((l) => l.segments !== undefined));
});

test("withIntralineHighlights pairs a del/add line across an intervening 'No newline at end of file' marker", () => {
  const parsedDiff = {
    hunks: [
      {
        header: "@@ -1,1 +1,1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { type: "del", oldLineNo: 1, newLineNo: null, content: "old content" },
          { type: "meta", oldLineNo: null, newLineNo: null, content: "\\ No newline at end of file" },
          { type: "add", oldLineNo: null, newLineNo: 1, content: "new content" },
          { type: "meta", oldLineNo: null, newLineNo: null, content: "\\ No newline at end of file" },
        ],
      },
    ],
    additions: 1,
    deletions: 1,
  };

  const result = withIntralineHighlights(parsedDiff);

  const [delLine, delMeta, addLine, addMeta] = result.hunks[0].lines;
  assert.ok(delLine.segments.some((s) => s.changed));
  assert.equal(delMeta.type, "meta");
  assert.equal(delMeta.segments, undefined);
  assert.ok(addLine.segments.some((s) => s.changed));
  assert.equal(addMeta.type, "meta");
  assert.equal(addMeta.segments, undefined);
});

test("withIntralineHighlights leaves lines unpaired when a del run and the following add run have different lengths", () => {
  const parsedDiff = {
    hunks: [
      {
        header: "@@ -1,2 +1,1 @@",
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 1,
        lines: [
          { type: "del", oldLineNo: 1, newLineNo: null, content: "one" },
          { type: "del", oldLineNo: 2, newLineNo: null, content: "two" },
          { type: "add", oldLineNo: null, newLineNo: 1, content: "merged" },
        ],
      },
    ],
    additions: 1,
    deletions: 2,
  };

  const result = withIntralineHighlights(parsedDiff);

  for (const line of result.hunks[0].lines) {
    assert.equal(line.segments, undefined);
  }
});
