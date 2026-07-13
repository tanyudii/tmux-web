import { test } from "node:test";
import assert from "node:assert/strict";
import { isCopyShortcut, copyResultMessage } from "./terminal-clipboard.js";

test("isCopyShortcut recognizes Cmd+C on keydown", () => {
  assert.equal(isCopyShortcut({ type: "keydown", metaKey: true, key: "c" }), true);
});

test("isCopyShortcut is case-insensitive on the key value", () => {
  assert.equal(isCopyShortcut({ type: "keydown", metaKey: true, key: "C" }), true);
});

test("isCopyShortcut ignores keyup so the copy doesn't fire twice per press", () => {
  assert.equal(isCopyShortcut({ type: "keyup", metaKey: true, key: "c" }), false);
});

test("isCopyShortcut leaves Ctrl+C alone so it still sends SIGINT to the shell", () => {
  assert.equal(isCopyShortcut({ type: "keydown", ctrlKey: true, key: "c" }), false);
});

test("isCopyShortcut ignores unrelated Cmd shortcuts", () => {
  assert.equal(isCopyShortcut({ type: "keydown", metaKey: true, key: "v" }), false);
});

test("copyResultMessage confirms success so the user knows the copy landed", () => {
  assert.equal(copyResultMessage(true), "Copied");
});

test("copyResultMessage points at the manual fallback on failure", () => {
  assert.equal(copyResultMessage(false), "Auto-copy failed — press Cmd+C in the box below");
});
