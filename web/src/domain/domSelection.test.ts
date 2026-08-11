import { describe, expect, it } from "vitest";
import { normalizeSelectedTerminalText } from "./domSelection";

describe("normalizeSelectedTerminalText", () => {
  it("returns null for an empty selection", () => {
    expect(normalizeSelectedTerminalText("")).toBeNull();
  });

  it("returns null for a selection that is only whitespace", () => {
    // Measured live in the Fase 0 spike: selecting the whole pane on an
    // otherwise-blank screen yields rows of a single padding space each.
    expect(normalizeSelectedTerminalText(" \n \n ")).toBeNull();
  });

  it("keeps a single line unchanged", () => {
    expect(normalizeSelectedTerminalText("npm run build")).toBe("npm run build");
  });

  it("strips the trailing padding spaces xterm renders on each row", () => {
    // xterm's DOM renderer pads every row out to the full column count, so a
    // raw selection carries invisible trailing spaces that would be pasted
    // back into a shell verbatim.
    expect(normalizeSelectedTerminalText("git status   \nnpm test     ")).toBe("git status\nnpm test");
  });

  it("drops the trailing blank rows below the last line of real output", () => {
    // Exact shape captured from the spike run:
    // "...third line 12345\n \n"
    expect(normalizeSelectedTerminalText("third line 12345\n \n")).toBe("third line 12345");
  });

  it("preserves blank lines that sit between real content", () => {
    expect(normalizeSelectedTerminalText("first\n \nsecond")).toBe("first\n\nsecond");
  });

  it("preserves leading indentation", () => {
    expect(normalizeSelectedTerminalText("    indented line   ")).toBe("    indented line");
  });

  it("normalizes CRLF rows to plain newlines", () => {
    expect(normalizeSelectedTerminalText("one\r\ntwo")).toBe("one\ntwo");
  });
});
