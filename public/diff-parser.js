// Pure diff-parsing logic, kept DOM-free and dependency-free on purpose: it
// is loaded both as a browser ES module (imported from app.js) and directly
// by Node's test runner (public/diff-parser.test.js), with no build step in
// either direction. See public/notify.js for the same pattern.

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

// Parses raw `git diff` output for a single file into hunks with per-line
// old/new line numbers. Lines before the first `@@` header (`diff --git`,
// `index`, `---`, `+++`, rename/mode lines) are noise the caller doesn't
// need -- the file path is already shown by the tree row -- so they're
// skipped rather than represented.
export function parseUnifiedDiff(diffText) {
  const lines = diffText === "" ? [] : diffText.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const hunks = [];
  let currentHunk = null;
  let oldLineNo = 0;
  let newLineNo = 0;
  let additions = 0;
  let deletions = 0;

  for (const rawLine of lines) {
    const headerMatch = HUNK_HEADER_PATTERN.exec(rawLine);
    if (headerMatch) {
      const oldStart = Number(headerMatch[1]);
      const newStart = Number(headerMatch[3]);
      currentHunk = {
        header: rawLine,
        oldStart,
        oldLines: headerMatch[2] === undefined ? 1 : Number(headerMatch[2]),
        newStart,
        newLines: headerMatch[4] === undefined ? 1 : Number(headerMatch[4]),
        lines: [],
      };
      hunks.push(currentHunk);
      oldLineNo = oldStart;
      newLineNo = newStart;
      continue;
    }

    if (!currentHunk) continue;

    if (rawLine.startsWith("\\")) {
      currentHunk.lines.push({ type: "meta", oldLineNo: null, newLineNo: null, content: rawLine });
      continue;
    }

    const marker = rawLine.charAt(0);
    const content = rawLine.slice(1);

    if (marker === "+") {
      currentHunk.lines.push({ type: "add", oldLineNo: null, newLineNo, content });
      newLineNo++;
      additions++;
    } else if (marker === "-") {
      currentHunk.lines.push({ type: "del", oldLineNo, newLineNo: null, content });
      oldLineNo++;
      deletions++;
    } else {
      currentHunk.lines.push({
        type: "context",
        oldLineNo,
        newLineNo,
        content: marker === " " ? content : rawLine,
      });
      oldLineNo++;
      newLineNo++;
    }
  }

  return { hunks, additions, deletions };
}

// Builds a synthetic single-hunk diff for an untracked file: there is no
// real diff to show, so every line of its content is rendered as an
// addition, same as how GitHub treats a brand-new file.
export function parsedDiffFromAdditions(text) {
  const lines = text === "" ? [] : text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  if (lines.length === 0) return { hunks: [], additions: 0, deletions: 0 };

  const hunkLines = lines.map((content, index) => ({
    type: "add",
    oldLineNo: null,
    newLineNo: index + 1,
    content,
  }));

  const hunk = {
    header: `@@ -0,0 +1,${lines.length} @@`,
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    lines: hunkLines,
  };

  return { hunks: [hunk], additions: lines.length, deletions: 0 };
}

// Splits a line into runs of word characters and runs of non-word
// characters (whitespace/punctuation), which is the granularity GitHub's
// own intraline highlight roughly targets.
function tokenize(line) {
  return line.match(/[A-Za-z0-9_]+|[^A-Za-z0-9_]+/g) || [];
}

// Standard O(n*m) LCS over two token arrays, backtracked into a sequence of
// equal/delete/insert ops.
function diffTokenOps(oldTokens, newTokens) {
  const n = oldTokens.length;
  const m = newTokens.length;
  const table = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        oldTokens[i] === newTokens[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldTokens[i] === newTokens[j]) {
      ops.push({ type: "equal", token: oldTokens[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: "delete", token: oldTokens[i] });
      i++;
    } else {
      ops.push({ type: "insert", token: newTokens[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "delete", token: oldTokens[i++] });
  while (j < m) ops.push({ type: "insert", token: newTokens[j++] });
  return ops;
}

// Collapses ops into merged {text, changed} segments, keeping "equal" ops
// plus whichever changed-side op type (`delete` for the old line, `insert`
// for the new line) the caller asks for.
function buildSegments(ops, keepType) {
  const segments = [];
  for (const op of ops) {
    if (op.type !== "equal" && op.type !== keepType) continue;
    const changed = op.type !== "equal";
    const last = segments[segments.length - 1];
    if (last && last.changed === changed) {
      segments[segments.length - 1] = { text: last.text + op.token, changed };
    } else {
      segments.push({ text: op.token, changed });
    }
  }
  return segments;
}

// Word-level (intraline) diff between a removed line and its replacement,
// mirroring GitHub's highlight of the exact characters that changed within
// a modified line pair, instead of just coloring the whole line.
export function computeLineWordDiff(oldLine, newLine) {
  const ops = diffTokenOps(tokenize(oldLine), tokenize(newLine));
  return {
    oldSegments: buildSegments(ops, "delete"),
    newSegments: buildSegments(ops, "insert"),
  };
}

// Scans a run of consecutive `type` lines starting at `start`, plus a
// single trailing "\ No newline at end of file" meta line if one directly
// follows -- git emits at most one such marker, right after the last line
// of old/new content it describes.
function scanRun(lines, start, type) {
  let end = start;
  while (end < lines.length && lines[end].type === type) end++;
  const items = lines.slice(start, end);
  let trailingMeta = null;
  if (lines[end] && lines[end].type === "meta") {
    trailingMeta = lines[end];
    end++;
  }
  return { items, trailingMeta, end };
}

// Pairs up equal-length runs of consecutive del/add lines within each hunk
// and attaches word-diff `segments` to each paired line, without disturbing
// their original del-then-add display order. Runs whose del and add counts
// don't match are left as plain add/del lines -- pairing them positionally
// would highlight unrelated lines against each other.
function annotateHunkLines(lines) {
  const result = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type !== "del") {
      result.push(lines[i]);
      i++;
      continue;
    }

    const delRun = scanRun(lines, i, "del");
    const addRun = scanRun(lines, delRun.end, "add");

    if (delRun.items.length === addRun.items.length) {
      const wordDiffs = delRun.items.map((delLine, k) => computeLineWordDiff(delLine.content, addRun.items[k].content));
      result.push(...delRun.items.map((delLine, k) => ({ ...delLine, segments: wordDiffs[k].oldSegments })));
      if (delRun.trailingMeta) result.push(delRun.trailingMeta);
      result.push(...addRun.items.map((addLine, k) => ({ ...addLine, segments: wordDiffs[k].newSegments })));
      if (addRun.trailingMeta) result.push(addRun.trailingMeta);
    } else {
      for (let k = i; k < addRun.end; k++) result.push(lines[k]);
    }

    i = addRun.end;
  }
  return result;
}

export function withIntralineHighlights(parsedDiff) {
  return {
    ...parsedDiff,
    hunks: parsedDiff.hunks.map((hunk) => ({ ...hunk, lines: annotateHunkLines(hunk.lines) })),
  };
}
