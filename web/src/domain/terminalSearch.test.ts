import { describe, expect, test } from "vitest";
import { isFindShortcut } from "./terminalSearch";

// Ports kmp/.../domain/TerminalSearchTest.kt 1:1.
describe("isFindShortcut", () => {
  test("recognizes Ctrl+F on keydown", () => {
    expect(isFindShortcut({ type: "keydown", ctrlKey: true, metaKey: false, key: "f" })).toBe(true);
  });

  test("recognizes Cmd+F on keydown", () => {
    expect(isFindShortcut({ type: "keydown", ctrlKey: false, metaKey: true, key: "f" })).toBe(true);
  });

  test("is case-insensitive on the key value", () => {
    expect(isFindShortcut({ type: "keydown", ctrlKey: true, metaKey: false, key: "F" })).toBe(true);
  });

  test("ignores keyup so search doesn't retrigger per press", () => {
    expect(isFindShortcut({ type: "keyup", ctrlKey: true, metaKey: false, key: "f" })).toBe(false);
  });

  test("ignores plain f with no modifier so typing still reaches the shell", () => {
    expect(isFindShortcut({ type: "keydown", ctrlKey: false, metaKey: false, key: "f" })).toBe(false);
  });

  test("ignores unrelated Ctrl shortcuts", () => {
    expect(isFindShortcut({ type: "keydown", ctrlKey: true, metaKey: false, key: "c" })).toBe(false);
  });
});
