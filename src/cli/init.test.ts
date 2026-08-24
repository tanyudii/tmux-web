import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../config.ts";
import { runInit } from "./init.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-init-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("runInit creates config.json when none exists", async () => {
  await withTempDir(async (dir) => {
    await runInit([], dir);
    const config = await readConfig(dir);
    assert.equal(config.port, 5309);
    assert.equal(config.host, "127.0.0.1");
  });
});

test("runInit does not overwrite an existing config without --force", async () => {
  await withTempDir(async (dir) => {
    await runInit([], dir);
    const before = await readConfig(dir);
    await runInit([], dir);
    const after = await readConfig(dir);
    assert.deepEqual(after, before);
  });
});

test("runInit overwrites an existing config with --force", async () => {
  await withTempDir(async (dir) => {
    await runInit([], dir);
    // Hand-modify the config so --force overwriting is observable.
    const { writeFile } = await import("node:fs/promises");
    const { configFilePath } = await import("../config.ts");
    await writeFile(configFilePath(dir), JSON.stringify({ port: 6000, host: "0.0.0.0" }));
    await runInit(["--force"], dir);
    const after = await readConfig(dir);
    assert.deepEqual(after, { port: 5309, host: "127.0.0.1" });
  });
});
