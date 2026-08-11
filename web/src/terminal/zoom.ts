// Ctrl/Cmd +/-/0 zoom stepping -- ports
// kmp/.../terminal/TerminalKeydownHandlers.wasmJs.kt's nextZoomFontSize.
// Same convention as browsers and every desktop terminal emulator.
export const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;

/** Returns the next font size for a zoom keystroke, or null if `key` isn't a zoom shortcut. */
export function nextZoomFontSize(key: string, currentSize: number): number | null {
  switch (key) {
    case "=":
    case "+":
      return Math.min(currentSize + 1, MAX_FONT_SIZE);
    case "-":
      return Math.max(currentSize - 1, MIN_FONT_SIZE);
    case "0":
      return DEFAULT_FONT_SIZE;
    default:
      return null;
  }
}
