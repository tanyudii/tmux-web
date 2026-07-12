import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBearerToken, extractQueryToken, verifyToken } from "./auth.ts";

test("extractBearerToken returns the token from a well-formed header", () => {
  assert.equal(extractBearerToken("Bearer secret123"), "secret123");
});

test("extractBearerToken is case-insensitive on the scheme name", () => {
  assert.equal(extractBearerToken("bearer secret123"), "secret123");
});

test("extractBearerToken trims surrounding whitespace from the token", () => {
  assert.equal(extractBearerToken("Bearer   secret123  "), "secret123");
});

test("extractBearerToken returns undefined for a missing header", () => {
  assert.equal(extractBearerToken(undefined), undefined);
});

test("extractBearerToken returns undefined for a non-Bearer scheme", () => {
  assert.equal(extractBearerToken("Basic dXNlcjpwYXNz"), undefined);
});

test("extractBearerToken returns undefined when no token follows the scheme", () => {
  assert.equal(extractBearerToken("Bearer"), undefined);
  assert.equal(extractBearerToken("Bearer "), undefined);
});

test("extractQueryToken reads the token query param from a URL", () => {
  assert.equal(extractQueryToken("/ws?session=main&token=secret123"), "secret123");
});

test("extractQueryToken returns undefined when token param is absent", () => {
  assert.equal(extractQueryToken("/ws?session=main"), undefined);
});

test("extractQueryToken returns undefined for an unparsable URL", () => {
  assert.equal(extractQueryToken("::not a url::"), undefined);
});

test("verifyToken returns true when provided matches expected exactly", () => {
  assert.equal(verifyToken("secret123", "secret123"), true);
});

test("verifyToken returns false when provided differs from expected", () => {
  assert.equal(verifyToken("wrong", "secret123"), false);
});

test("verifyToken returns false when lengths differ", () => {
  assert.equal(verifyToken("short", "a-much-longer-secret"), false);
});

test("verifyToken returns false when provided is undefined", () => {
  assert.equal(verifyToken(undefined, "secret123"), false);
});

test("verifyToken fails closed when the expected token is empty", () => {
  // A misconfigured server (no token set) must never grant access.
  assert.equal(verifyToken("", ""), false);
  assert.equal(verifyToken("anything", ""), false);
});
