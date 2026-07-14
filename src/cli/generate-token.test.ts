import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigNotFoundError, readConfig } from "../config.ts";
import { runInit } from "./init.ts";
import { runGenerate } from "./generate-token.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-generate-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("runGenerate rotates the token but keeps port/host", async () => {
  await withTempDir(async (dir) => {
    await runInit([], dir);
    const before = await readConfig(dir);
    await runGenerate([], dir);
    const after = await readConfig(dir);
    assert.notEqual(after.token, before.token);
    assert.equal(after.port, before.port);
    assert.equal(after.host, before.host);
  });
});

test("runGenerate throws ConfigNotFoundError when no config exists yet", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(() => runGenerate([], dir), ConfigNotFoundError);
  });
});
