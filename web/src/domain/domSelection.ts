// Cleans up what a browser-native text selection over xterm's DOM rows
// actually produces, so the mobile copy flow puts usable text on the
// clipboard rather than the renderer's padding.
//
// Shape confirmed live against real @xterm/xterm in a Chromium spike (the
// library cannot run under jsdom at all -- see terminal/TerminalView.tsx's
// header): xterm's DOM renderer emits one <div> per row, pads each row out
// to the full column count with spaces, and renders a blank row as a single
// space. Selecting a three-line pane therefore yields
//   "line one\nline two\nline three\n \n"
// -- trailing spaces the shell would receive verbatim on a paste-back, plus
// phantom blank rows for the unused bottom of the screen.
//
// Interior blank lines are deliberately kept (collapsed to ""), since a gap
// between two blocks of real output is content, not padding.

/** Returns the cleaned selection, or null when nothing meaningful was selected. */
export function normalizeSelectedTerminalText(raw: string): string | null {
  if (raw === "") return null;

  const lines = raw.replace(/\r\n/g, "\n").split("\n").map(trimTrailingWhitespace);

  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end -= 1;
  let start = 0;
  while (start < end && lines[start] === "") start += 1;

  if (start === end) return null;
  return lines.slice(start, end).join("\n");
}

function trimTrailingWhitespace(line: string): string {
  return line.replace(/\s+$/, "");
}
