import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeServiceName } from "./service-name.ts";

test("sanitizeServiceName returns undefined for null", () => {
  assert.equal(sanitizeServiceName(null), undefined);
});

test("sanitizeServiceName returns undefined for an empty string", () => {
  assert.equal(sanitizeServiceName(""), undefined);
});

test("sanitizeServiceName accepts a typical docker compose service name", () => {
  assert.equal(sanitizeServiceName("web"), "web");
});

test("sanitizeServiceName accepts digits, underscores, dots and hyphens after the first character", () => {
  assert.equal(sanitizeServiceName("worker-2.v1_beta"), "worker-2.v1_beta");
});

test("sanitizeServiceName rejects a leading dash so it can't be mistaken for a docker compose CLI flag", () => {
  assert.equal(sanitizeServiceName("--verbose"), undefined);
});

test("sanitizeServiceName rejects a leading dot", () => {
  assert.equal(sanitizeServiceName(".hidden"), undefined);
});

test("sanitizeServiceName rejects whitespace", () => {
  assert.equal(sanitizeServiceName("web worker"), undefined);
});
