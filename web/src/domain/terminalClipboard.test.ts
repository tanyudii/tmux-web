import { describe, expect, test } from "vitest";
import { COPY_NO_SELECTION_MESSAGE, copyResultMessage, isCopyShortcut } from "./terminalClipboard";

// Ports kmp/.../domain/TerminalClipboardTest.kt 1:1 (itself a port of
// public/terminal-clipboard.test.js).
describe("isCopyShortcut", () => {
  test("recognizes Cmd+C on keydown", () => {
    const result = isCopyShortcut({ type: "keydown", metaKey: true, ctrlKey: false, shiftKey: false, key: "c" });

    expect(result).toBe(true);
  });

  test("is case-insensitive on the key value", () => {
    const result = isCopyShortcut({ type: "keydown", metaKey: true, ctrlKey: false, shiftKey: false, key: "C" });

    expect(result).toBe(true);
  });

  test("ignores keyup so the copy doesn't fire twice per press", () => {
    const result = isCopyShortcut({ type: "keyup", metaKey: true, ctrlKey: false, shiftKey: false, key: "c" });

    expect(result).toBe(false);
  });

  test("recognizes plain Ctrl+C as a copy attempt -- same convention as coolify's terminal", () => {
    const result = isCopyShortcut({ type: "keydown", metaKey: false, ctrlKey: true, shiftKey: false, key: "c" });

    expect(result).toBe(true);
  });

  test("ignores unrelated Cmd shortcuts", () => {
    const result = isCopyShortcut({ type: "keydown", metaKey: true, ctrlKey: false, shiftKey: false, key: "v" });

    expect(result).toBe(false);
  });

  test("ignores Cmd+Shift+C so it doesn't collide with the macOS devtools inspector shortcut", () => {
    const result = isCopyShortcut({ type: "keydown", metaKey: true, ctrlKey: false, shiftKey: true, key: "C" });

    expect(result).toBe(false);
  });

  test("ignores Ctrl+Shift+C so it doesn't collide with the Windows/Linux devtools inspector shortcut", () => {
    const result = isCopyShortcut({ type: "keydown", metaKey: false, ctrlKey: true, shiftKey: true, key: "C" });

    expect(result).toBe(false);
  });
});

describe("copyResultMessage", () => {
  test("success message confirms the copy", () => {
    expect(copyResultMessage(true)).toBe("Copied");
  });

  test("failure message tells the user to copy manually", () => {
    expect(copyResultMessage(false)).toBe("Auto-copy failed — select the text and copy manually");
  });
});

test("no-selection message tells the user how to select terminal text", () => {
  expect(COPY_NO_SELECTION_MESSAGE).toBe(
    "No text selected — hold Option (Mac) or Shift (Windows/Linux) while dragging, then copy again",
  );
});
