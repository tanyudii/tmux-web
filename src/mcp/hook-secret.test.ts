import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateHookSecret, hookSecretPath } from "./hook-secret.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-mcp-secret-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadOrCreateHookSecret generates a new secret when none exists yet", async () => {
  await withTempDir(async (configDir) => {
    const secret = await loadOrCreateHookSecret(configDir);
    assert.equal(typeof secret, "string");
    assert.ok(secret.length >= 32);
  });
});

test("loadOrCreateHookSecret returns the same secret on a second call -- stable across process restarts", async () => {
  await withTempDir(async (configDir) => {
    const first = await loadOrCreateHookSecret(configDir);
    const second = await loadOrCreateHookSecret(configDir);
    assert.equal(first, second);
  });
});

test("loadOrCreateHookSecret writes the secret file with owner-only permissions", async () => {
  await withTempDir(async (configDir) => {
    await loadOrCreateHookSecret(configDir);
    const stats = await stat(hookSecretPath(configDir));
    assert.equal(stats.mode & 0o777, 0o600);
  });
});

test("loadOrCreateHookSecret leaves no leftover temp file after a successful write", async () => {
  await withTempDir(async (configDir) => {
    await loadOrCreateHookSecret(configDir);
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(configDir);
    assert.deepEqual(entries, ["mcp-hook-secret"]);
  });
});
