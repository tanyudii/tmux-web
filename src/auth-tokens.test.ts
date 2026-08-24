import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAuthTokens, saveAuthTokens, issueAuthToken, resolveAuthToken, revokeAuthToken, revokeAllTokensForUser } from "./auth-tokens.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-auth-tokens-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadAuthTokens returns an empty array when the file does not exist", async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(await loadAuthTokens(join(dir, "missing.json")), []);
  });
});

test("saveAuthTokens then loadAuthTokens round-trips the data", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "auth-tokens.json");
    const tokens = [{ tokenHash: "abc", username: "alice", createdAt: "2026-01-01T00:00:00.000Z" }];
    await saveAuthTokens(filePath, tokens);
    assert.deepEqual(await loadAuthTokens(filePath), tokens);
  });
});

test("issueAuthToken returns a raw token that resolveAuthToken maps back to the username", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "auth-tokens.json");
    const rawToken = await issueAuthToken(filePath, "alice");

    assert.equal(typeof rawToken, "string");
    assert.ok(rawToken.length >= 32);
    assert.equal(await resolveAuthToken(filePath, rawToken), "alice");

    const persisted = await loadAuthTokens(filePath);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].username, "alice");
    assert.notEqual(persisted[0].tokenHash, rawToken);
  });
});

test("resolveAuthToken returns undefined for an unknown or missing token", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "auth-tokens.json");
    await issueAuthToken(filePath, "alice");

    assert.equal(await resolveAuthToken(filePath, "not-a-real-token"), undefined);
    assert.equal(await resolveAuthToken(filePath, undefined), undefined);
  });
});

test("revokeAuthToken removes only the matching token", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "auth-tokens.json");
    const tokenA = await issueAuthToken(filePath, "alice");
    const tokenB = await issueAuthToken(filePath, "bob");

    await revokeAuthToken(filePath, tokenA);

    assert.equal(await resolveAuthToken(filePath, tokenA), undefined);
    assert.equal(await resolveAuthToken(filePath, tokenB), "bob");
  });
});

test("two issued tokens for the same user never collide", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "auth-tokens.json");
    const tokenA = await issueAuthToken(filePath, "alice");
    const tokenB = await issueAuthToken(filePath, "alice");

    assert.notEqual(tokenA, tokenB);
    assert.equal(await resolveAuthToken(filePath, tokenA), "alice");
    assert.equal(await resolveAuthToken(filePath, tokenB), "alice");
  });
});

test("resolveAuthToken rejects a token older than the 30-day TTL", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "auth-tokens.json");
    const rawToken = await issueAuthToken(filePath, "alice");

    const tokens = await loadAuthTokens(filePath);
    const aged = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await saveAuthTokens(filePath, tokens.map((token) => ({ ...token, createdAt: aged })));

    assert.equal(await resolveAuthToken(filePath, rawToken), undefined);
  });
});

test("revokeAllTokensForUser removes every token for the user but leaves others alone", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "auth-tokens.json");
    const aliceA = await issueAuthToken(filePath, "alice");
    const aliceB = await issueAuthToken(filePath, "alice");
    const bob = await issueAuthToken(filePath, "bob");

    await revokeAllTokensForUser(filePath, "alice");

    assert.equal(await resolveAuthToken(filePath, aliceA), undefined);
    assert.equal(await resolveAuthToken(filePath, aliceB), undefined);
    assert.equal(await resolveAuthToken(filePath, bob), "bob");
  });
});
