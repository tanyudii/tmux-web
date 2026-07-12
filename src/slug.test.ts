import { test } from "node:test";
import assert from "node:assert/strict";
import { slugifyBranchName } from "./slug.ts";

test("slugifyBranchName lowercases and replaces spaces with dashes", () => {
  assert.equal(slugifyBranchName("My Feature"), "my-feature");
});

test("slugifyBranchName trims leading and trailing whitespace", () => {
  assert.equal(slugifyBranchName("  leading and trailing  "), "leading-and-trailing");
});

test("slugifyBranchName strips characters outside a-z0-9.-", () => {
  assert.equal(slugifyBranchName("special!@#$%^&*()chars"), "specialchars");
});

test("slugifyBranchName strips underscores (reserved as the session-name separator)", () => {
  assert.equal(slugifyBranchName("foo_bar"), "foobar");
});

test("slugifyBranchName collapses repeated whitespace into a single dash", () => {
  assert.equal(slugifyBranchName("multiple   spaces"), "multiple-spaces");
});

test("slugifyBranchName collapses repeated dashes into one", () => {
  assert.equal(slugifyBranchName("a---b"), "a-b");
});

test("slugifyBranchName collapses repeated dots into one", () => {
  assert.equal(slugifyBranchName("a..b"), "a.b");
});

test("slugifyBranchName strips leading and trailing dashes and dots", () => {
  assert.equal(slugifyBranchName("---leading-dashes"), "leading-dashes");
  assert.equal(slugifyBranchName("trailing-dashes---"), "trailing-dashes");
  assert.equal(slugifyBranchName(".leading.dot"), "leading.dot");
});

test("slugifyBranchName strips non-ASCII characters", () => {
  assert.equal(slugifyBranchName("café"), "caf");
});

test("slugifyBranchName truncates to the max length and re-trims trailing separators", () => {
  const input = "a".repeat(60) + "-" + "b".repeat(10);
  const result = slugifyBranchName(input, 60);
  assert.equal(result.length <= 60, true);
  assert.equal(/[-.]$/.test(result), false);
});

test("slugifyBranchName returns an empty string for input with nothing sluggable", () => {
  assert.equal(slugifyBranchName("!!!"), "");
  assert.equal(slugifyBranchName(""), "");
});
