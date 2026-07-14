import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, readConfig } from "../config.ts";
import { runInit } from "./init.ts";
import { runConfigCommand } from "./config-command.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-config-cmd-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("runConfigCommand sets the port", async () => {
  await withTempDir(async (dir) => {
    await runInit([], dir);
    await runConfigCommand(["port", "6000"], dir);
    assert.equal((await readConfig(dir)).port, 6000);
  });
});

test("runConfigCommand sets the host", async () => {
  await withTempDir(async (dir) => {
    await runInit([], dir);
    await runConfigCommand(["host", "0.0.0.0"], dir);
    assert.equal((await readConfig(dir)).host, "0.0.0.0");
  });
});

test("runConfigCommand rejects an out-of-range port", async () => {
  await withTempDir(async (dir) => {
    await runInit([], dir);
    await assert.rejects(() => runConfigCommand(["port", "70000"], dir), ConfigError);
  });
});

test("runConfigCommand rejects a non-numeric port", async () => {
  await withTempDir(async (dir) => {
    await runInit([], dir);
    await assert.rejects(() => runConfigCommand(["port", "abc"], dir), ConfigError);
  });
});

test("runConfigCommand rejects an unknown field", async () => {
  await withTempDir(async (dir) => {
    await runInit([], dir);
    await assert.rejects(() => runConfigCommand(["dataDir", "/tmp"], dir), ConfigError);
  });
});

test("runConfigCommand rejects a missing value", async () => {
  await withTempDir(async (dir) => {
    await runInit([], dir);
    await assert.rejects(() => runConfigCommand(["port"], dir), ConfigError);
  });
});
