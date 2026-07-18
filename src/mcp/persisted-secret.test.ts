import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateSecret } from "./persisted-secret.ts";

async function withTempFile(fn: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-persisted-secret-"));
  try {
    await fn(join(dir, "some-secret"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadOrCreateSecret generates a new secret when none exists yet", async () => {
  await withTempFile(async (filePath) => {
    const secret = await loadOrCreateSecret(filePath);
    assert.equal(typeof secret, "string");
    assert.ok(secret.length >= 32);
  });
});

test("loadOrCreateSecret returns the same secret on a second call", async () => {
  await withTempFile(async (filePath) => {
    const first = await loadOrCreateSecret(filePath);
    const second = await loadOrCreateSecret(filePath);
    assert.equal(first, second);
  });
});

test("loadOrCreateSecret writes the file with owner-only permissions", async () => {
  await withTempFile(async (filePath) => {
    await loadOrCreateSecret(filePath);
    const stats = await stat(filePath);
    assert.equal(stats.mode & 0o777, 0o600);
  });
});

test("loadOrCreateSecret leaves no leftover temp file after a successful write", async () => {
  await withTempFile(async (filePath) => {
    await loadOrCreateSecret(filePath);
    const { readdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const entries = await readdir(path.dirname(filePath));
    assert.deepEqual(entries, [path.basename(filePath)]);
  });
});
