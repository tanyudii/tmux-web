// Ports kmp/composeApp/.../domain/DiffLineParser.kt (itself a port of
// public/diff-parser.js's parseUnifiedDiff, see commit 94514e6 / removed in
// 2d3b55c's cutover to kmp/). Parses raw `git diff` output for a single
// file into hunks with per-line old/new line numbers, plus a GitHub-style
// word-level (intraline) diff for paired del/add line runs.
const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export type DiffRowType = "add" | "del" | "context" | "meta";

export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface DiffRow {
  type: DiffRowType;
  oldLineNo: number | null;
  newLineNo: number | null;
  content: string;
  segments: DiffSegment[] | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffRow[];
}

export interface ParsedDiff {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

function splitDiffLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function row(type: DiffRowType, oldLineNo: number | null, newLineNo: number | null, content: string): DiffRow {
  return { type, oldLineNo, newLineNo, content, segments: null };
}

// Mirrors Kotlin's UnifiedDiffBuilder as a small stateful class local to
// this module -- lines before the first `@@` header (`diff --git`,
// `index`, `---`, `+++`, rename/mode lines) are noise the caller doesn't
// need, so they're skipped rather than represented.
class UnifiedDiffBuilder {
  private hunks: DiffHunk[] = [];
  private header: string | null = null;
  private oldStart = 0;
  private oldLines = 0;
  private newStart = 0;
  private newLines = 0;
  private lines: DiffRow[] = [];
  private oldLineNo = 0;
  private newLineNo = 0;
  private additions = 0;
  private deletions = 0;

  get isInsideHunk(): boolean {
    return this.header !== null;
  }

  startHunk(rawLine: string, match: RegExpExecArray): void {
    this.flushHunk();
    this.oldStart = Number(match[1]);
    this.newStart = Number(match[3]);
    this.oldLines = match[2] ? Number(match[2]) : 1;
    this.newLines = match[4] ? Number(match[4]) : 1;
    this.header = rawLine;
    this.lines = [];
    this.oldLineNo = this.oldStart;
    this.newLineNo = this.newStart;
  }

  addMeta(rawLine: string): void {
    this.lines.push(row("meta", null, null, rawLine));
  }

  addContentLine(rawLine: string): void {
    const marker = rawLine[0];
    if (marker === "+") {
      this.lines.push(row("add", null, this.newLineNo, rawLine.slice(1)));
      this.newLineNo++;
      this.additions++;
    } else if (marker === "-") {
      this.lines.push(row("del", this.oldLineNo, null, rawLine.slice(1)));
      this.oldLineNo++;
      this.deletions++;
    } else {
      const content = marker === " " ? rawLine.slice(1) : rawLine;
      this.lines.push(row("context", this.oldLineNo, this.newLineNo, content));
      this.oldLineNo++;
      this.newLineNo++;
    }
  }

  flushHunk(): void {
    if (this.header === null) return;
    this.hunks.push({
      header: this.header,
      oldStart: this.oldStart,
      oldLines: this.oldLines,
      newStart: this.newStart,
      newLines: this.newLines,
      lines: this.lines,
    });
  }

  build(): ParsedDiff {
    this.flushHunk();
    return { hunks: this.hunks, additions: this.additions, deletions: this.deletions };
  }
}

export function parseUnifiedDiff(diffText: string): ParsedDiff {
  const builder = new UnifiedDiffBuilder();
  for (const rawLine of splitDiffLines(diffText)) {
    const headerMatch = HUNK_HEADER_PATTERN.exec(rawLine);
    if (headerMatch) {
      builder.startHunk(rawLine, headerMatch);
    } else if (!builder.isInsideHunk) {
      // Noise before the first hunk header -- skipped.
    } else if (rawLine.startsWith("\\")) {
      builder.addMeta(rawLine);
    } else {
      builder.addContentLine(rawLine);
    }
  }
  return builder.build();
}

/**
 * Builds a synthetic single-hunk diff for an untracked file: there is no
 * real diff to show, so every line of its content is rendered as an
 * addition, same as how GitHub treats a brand-new file.
 */
export function parsedDiffFromAdditions(text: string): ParsedDiff {
  const lines = splitDiffLines(text);
  if (lines.length === 0) return { hunks: [], additions: 0, deletions: 0 };

  const hunkLines = lines.map((content, index) => row("add", null, index + 1, content));
  const hunk: DiffHunk = {
    header: `@@ -0,0 +1,${lines.length} @@`,
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    lines: hunkLines,
  };
  return { hunks: [hunk], additions: lines.length, deletions: 0 };
}

export interface LineWordDiff {
  oldSegments: DiffSegment[];
  newSegments: DiffSegment[];
}

const TOKEN_PATTERN = /[A-Za-z0-9_]+|[^A-Za-z0-9_]+/g;

function tokenize(line: string): string[] {
  return line.match(TOKEN_PATTERN) ?? [];
}

type TokenOp =
  | { kind: "equal"; token: string }
  | { kind: "delete"; token: string }
  | { kind: "insert"; token: string };

/** Standard O(n*m) LCS over two token arrays, backtracked into a sequence of equal/delete/insert ops. */
function diffTokenOps(oldTokens: string[], newTokens: string[]): TokenOp[] {
  const n = oldTokens.length;
  const m = newTokens.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        oldTokens[i] === newTokens[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops: TokenOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldTokens[i] === newTokens[j]) {
      ops.push({ kind: "equal", token: oldTokens[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: "delete", token: oldTokens[i] });
      i++;
    } else {
      ops.push({ kind: "insert", token: newTokens[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "delete", token: oldTokens[i++] });
  while (j < m) ops.push({ kind: "insert", token: newTokens[j++] });
  return ops;
}

/** Collapses ops into merged segments, keeping "equal" ops plus whichever changed-side op the caller asks for. */
function buildSegments(ops: TokenOp[], keepInsert: boolean): DiffSegment[] {
  const relevant: Array<[string, boolean]> = [];
  for (const op of ops) {
    if (op.kind === "equal") relevant.push([op.token, false]);
    else if (op.kind === "insert" && keepInsert) relevant.push([op.token, true]);
    else if (op.kind === "delete" && !keepInsert) relevant.push([op.token, true]);
  }

  const segments: DiffSegment[] = [];
  for (const [text, changed] of relevant) {
    const last = segments.at(-1);
    if (last && last.changed === changed) {
      last.text += text;
    } else {
      segments.push({ text, changed });
    }
  }
  return segments;
}

/**
 * Word-level (intraline) diff between a removed line and its replacement,
 * mirroring GitHub's highlight of the exact characters that changed within
 * a modified line pair, instead of just coloring the whole line.
 */
export function computeLineWordDiff(oldLine: string, newLine: string): LineWordDiff {
  const ops = diffTokenOps(tokenize(oldLine), tokenize(newLine));
  return {
    oldSegments: buildSegments(ops, false),
    newSegments: buildSegments(ops, true),
  };
}

interface Run {
  items: DiffRow[];
  trailingMeta: DiffRow | null;
  end: number;
}

/**
 * Scans a run of consecutive `type` lines starting at `start`, plus a
 * single trailing "\ No newline at end of file" meta line if one directly
 * follows -- git emits at most one such marker, right after the last line
 * of old/new content it describes.
 */
function scanRun(lines: DiffRow[], start: number, type: DiffRowType): Run {
  let end = start;
  while (end < lines.length && lines[end].type === type) end++;
  const items = lines.slice(start, end);
  const trailing = lines[end];
  const trailingMeta = trailing && trailing.type === "meta" ? trailing : null;
  const newEnd = trailingMeta ? end + 1 : end;
  return { items, trailingMeta, end: newEnd };
}

/**
 * Pairs up equal-length runs of consecutive del/add lines within each hunk
 * and attaches word-diff `segments` to each paired line, without disturbing
 * their original del-then-add display order. Runs whose del and add counts
 * don't match are left as plain add/del lines -- pairing them positionally
 * would highlight unrelated lines against each other.
 */
function annotateHunkLines(lines: DiffRow[]): DiffRow[] {
  const result: DiffRow[] = [];
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

export function withIntralineHighlights(parsedDiff: ParsedDiff): ParsedDiff {
  return {
    ...parsedDiff,
    hunks: parsedDiff.hunks.map((hunk) => ({ ...hunk, lines: annotateHunkLines(hunk.lines) })),
  };
}
