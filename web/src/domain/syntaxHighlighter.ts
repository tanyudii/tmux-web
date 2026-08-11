// Ports kmp/composeApp/.../domain/SyntaxHighlighter.kt (EMB-206). Splits one
// diff line into colorable tokens. Deliberately single-line and stateless --
// a diff hunk view has no cross-line context (a hunk can start or end
// mid-way through a multi-line block comment/string with no indication in
// the line itself), so a real lexer's carry-over state isn't available
// here. A line inside a `/* ... */` block simply won't be recognized as a
// comment; line comments, single-line strings, keywords, and numbers -- the
// common case -- are still highlighted correctly.
export type SyntaxLanguage = "kotlin" | "typescript" | "javascript" | "go" | "plain";
export type TokenKind = "keyword" | "string" | "comment" | "number" | "plain";

export interface SyntaxToken {
  text: string;
  kind: TokenKind;
}

const EXTENSION_LANGUAGE: Record<string, SyntaxLanguage> = {
  kt: "kotlin",
  kts: "kotlin",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  go: "go",
};

/** Falls back to "plain" for unrecognized/missing extensions -- tokenizeLine then no-ops. */
export function languageForFileName(fileName: string): SyntaxLanguage {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return "plain";
  return EXTENSION_LANGUAGE[fileName.slice(dotIndex + 1).toLowerCase()] ?? "plain";
}

// Intentionally small, curated sets -- not exhaustive language grammars.
// Covers the languages this project's own source is written in (Kotlin and
// TypeScript for tmux-web itself).
const KEYWORDS: Record<Exclude<SyntaxLanguage, "plain">, Set<string>> = {
  kotlin: new Set([
    "fun", "val", "var", "class", "object", "interface", "if", "else", "when", "for", "while", "do",
    "return", "import", "package", "private", "public", "internal", "protected", "override", "companion",
    "is", "as", "in", "null", "true", "false", "this", "super", "try", "catch", "finally", "throw",
    "suspend", "data", "sealed", "enum", "typealias", "constructor", "init", "by", "lateinit", "const",
    "vararg", "inline", "reified", "operator", "infix", "annotation", "actual", "expect",
  ]),
  typescript: new Set([
    "function", "const", "let", "var", "class", "interface", "type", "if", "else", "switch", "case",
    "for", "while", "do", "return", "import", "export", "from", "default", "private", "public", "protected",
    "readonly", "static", "extends", "implements", "new", "this", "super", "try", "catch", "finally",
    "throw", "async", "await", "null", "undefined", "true", "false", "typeof", "instanceof", "as",
    "enum", "namespace", "declare", "abstract", "void", "in", "of", "yield",
  ]),
  javascript: new Set([
    "function", "const", "let", "var", "class", "if", "else", "switch", "case", "for", "while", "do",
    "return", "import", "export", "from", "default", "extends", "new", "this", "super", "try", "catch",
    "finally", "throw", "async", "await", "null", "undefined", "true", "false", "typeof", "instanceof",
    "in", "of", "yield",
  ]),
  go: new Set([
    "func", "var", "const", "type", "struct", "interface", "if", "else", "switch", "case", "for", "range",
    "return", "import", "package", "go", "chan", "select", "defer", "map", "nil", "true", "false", "break",
    "continue", "fallthrough", "default", "goto",
  ]),
};

const WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/y;
const DIGIT_PATTERN = /[0-9]/;
const LETTER_PATTERN = /[A-Za-z]/;

function matchWordAt(line: string, index: number): string | null {
  WORD_PATTERN.lastIndex = index;
  const match = WORD_PATTERN.exec(line);
  return match ? match[0] : null;
}

function findStringEnd(line: string, start: number, quote: string): number {
  let j = start;
  while (j < line.length) {
    if (line[j] === "\\" && j + 1 < line.length) {
      j += 2;
      continue;
    }
    if (line[j] === quote) return j + 1;
    j++;
  }
  return line.length;
}

export function tokenizeLine(line: string, language: SyntaxLanguage): SyntaxToken[] {
  if (language === "plain" || line.length === 0) return [{ text: line, kind: "plain" }];

  const keywords = KEYWORDS[language];
  const tokens: SyntaxToken[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "/" && i + 1 < line.length && line[i + 1] === "/") {
      tokens.push({ text: line.slice(i), kind: "comment" });
      i = line.length;
    } else if (c === '"' || c === "'" || c === "`") {
      const end = findStringEnd(line, i + 1, c);
      tokens.push({ text: line.slice(i, end), kind: "string" });
      i = end;
    } else if (DIGIT_PATTERN.test(c)) {
      let j = i;
      while (j < line.length && (DIGIT_PATTERN.test(line[j]) || line[j] === ".")) j++;
      tokens.push({ text: line.slice(i, j), kind: "number" });
      i = j;
    } else if (LETTER_PATTERN.test(c) || c === "_") {
      const word = matchWordAt(line, i) ?? c;
      tokens.push({ text: word, kind: keywords.has(word) ? "keyword" : "plain" });
      i += word.length;
    } else {
      tokens.push({ text: c, kind: "plain" });
      i++;
    }
  }
  return mergeAdjacentPlain(tokens);
}

// Character-by-character tokenizing emits one plain token per punctuation/
// whitespace character -- merge runs of them so the caller sees "  return "
// once, not five single-char tokens.
function mergeAdjacentPlain(tokens: SyntaxToken[]): SyntaxToken[] {
  const merged: SyntaxToken[] = [];
  for (const token of tokens) {
    const last = merged.at(-1);
    if (last && last.kind === "plain" && token.kind === "plain") {
      last.text += token.text;
    } else {
      merged.push({ ...token });
    }
  }
  return merged;
}
