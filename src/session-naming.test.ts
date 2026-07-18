import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSessionName, parseSessionName, belongsToProject, splitPaneSessionName } from "./session-naming.ts";

test("buildSessionName joins projectId and sessionSlug with the separator", () => {
  assert.equal(buildSessionName("proj1", "feature-x"), "proj1__feature-x");
});

test("buildSessionName throws when projectId contains the separator", () => {
  assert.throws(() => buildSessionName("pro__j1", "feature-x"));
});

test("buildSessionName throws when sessionSlug contains the separator", () => {
  assert.throws(() => buildSessionName("proj1", "fea__ture"));
});

test("buildSessionName throws when the combined name exceeds tmux's 64-char limit", () => {
  assert.throws(() => buildSessionName("p".repeat(40), "s".repeat(30)));
});

test("buildSessionName accepts a combined name at exactly 64 characters", () => {
  const name = buildSessionName("p".repeat(30), "s".repeat(32));
  assert.equal(name.length, 64);
});

test("parseSessionName splits on the first separator", () => {
  assert.deepEqual(parseSessionName("proj1__feature-x"), {
    projectId: "proj1",
    sessionSlug: "feature-x",
  });
});

test("parseSessionName treats everything after the first separator as the slug", () => {
  assert.deepEqual(parseSessionName("proj1__feat__ure"), {
    projectId: "proj1",
    sessionSlug: "feat__ure",
  });
});

test("parseSessionName returns null when there is no separator", () => {
  assert.equal(parseSessionName("no-separator-here"), null);
});

test("parseSessionName returns null when the projectId half is empty", () => {
  assert.equal(parseSessionName("__missing-project"), null);
});

test("parseSessionName returns null when the sessionSlug half is empty", () => {
  assert.equal(parseSessionName("proj1__"), null);
});

test("parseSessionName returns null for an empty string", () => {
  assert.equal(parseSessionName(""), null);
});

test("belongsToProject matches only the exact projectId, not a string prefix", () => {
  assert.equal(belongsToProject("proj1__feature-x", "proj1"), true);
  assert.equal(belongsToProject("proj1__feature-x", "proj2"), false);
  assert.equal(belongsToProject("proj10__feature-x", "proj1"), false);
});

test("splitPaneSessionName is deterministic for the same fullName", () => {
  assert.equal(splitPaneSessionName("proj1__feature-x"), splitPaneSessionName("proj1__feature-x"));
});

test("splitPaneSessionName differs for different fullNames", () => {
  assert.notEqual(splitPaneSessionName("proj1__feature-x"), splitPaneSessionName("proj1__feature-y"));
});

test("splitPaneSessionName always fits tmux's 64-char session-name cap regardless of fullName's length", () => {
  const longName = `${"p".repeat(40)}__${"s".repeat(21)}`; // exactly 64 chars, buildSessionName's own max
  assert.ok(splitPaneSessionName(longName).length <= 64);
});

test("splitPaneSessionName produces a name matching isValidSessionName's charset", () => {
  assert.match(splitPaneSessionName("proj1__feature-x"), /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/);
});
