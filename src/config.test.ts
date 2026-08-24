import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configExists,
  configFilePath,
  ConfigError,
  ConfigNotFoundError,
  createDefaultConfig,
  readConfig,
  writeConfig,
} from "./config.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-config-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readConfig throws ConfigNotFoundError when config.json does not exist", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(() => readConfig(dir), ConfigNotFoundError);
  });
});

test("configExists returns false before init, true after writeConfig", async () => {
  await withTempDir(async (dir) => {
    assert.equal(await configExists(dir), false);
    await writeConfig(createDefaultConfig(), dir);
    assert.equal(await configExists(dir), true);
  });
});

test("writeConfig then readConfig round-trips the same values", async () => {
  await withTempDir(async (dir) => {
    const config = { port: 6000, host: "0.0.0.0" };
    await writeConfig(config, dir);
    assert.deepEqual(await readConfig(dir), config);
  });
});

test("readConfig ignores a legacy token field from the pre-multi-user config", async () => {
  await withTempDir(async (dir) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(configFilePath(dir), JSON.stringify({ token: "legacy-shared-token", port: 6000, host: "0.0.0.0" }));
    assert.deepEqual(await readConfig(dir), { port: 6000, host: "0.0.0.0" });
  });
});

test("readConfig fills in defaults for an empty config.json", async () => {
  await withTempDir(async (dir) => {
    await writeConfig({} as never, dir);
    const config = await readConfig(dir);
    assert.equal(config.port, 5309);
    assert.equal(config.host, "127.0.0.1");
  });
});

test("readConfig throws ConfigError when port is out of range", async () => {
  await withTempDir(async (dir) => {
    await writeConfig({ port: 70000, host: "127.0.0.1" } as never, dir);
    await assert.rejects(() => readConfig(dir), ConfigError);
  });
});

test("readConfig throws ConfigError when config.json is not valid JSON", async () => {
  await withTempDir(async (dir) => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await writeFile(configFilePath(dir), "not json");
    await assert.rejects(() => readConfig(dir), ConfigError);
  });
});

test("createDefaultConfig round-trips through writeConfig/readConfig", async () => {
  await withTempDir(async (dir) => {
    const config = createDefaultConfig();
    await writeConfig(config, dir);
    assert.deepEqual(await readConfig(dir), config);
  });
});
