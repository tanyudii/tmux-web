import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvConfig, EnvConfigError } from "./env-config.ts";

async function withWorktree(fn: (worktreePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-env-config-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadEnvConfig returns null when .tmux-web-env/docker-compose.yml is absent", async () => {
  await withWorktree(async (worktreePath) => {
    const config = await loadEnvConfig(worktreePath);
    assert.equal(config, null);
  });
});

test("loadEnvConfig resolves composeFile and reports null scripts when absent", async () => {
  await withWorktree(async (worktreePath) => {
    await mkdir(join(worktreePath, ".tmux-web-env"), { recursive: true });
    await writeFile(join(worktreePath, ".tmux-web-env", "docker-compose.yml"), "services: {}\n");

    const config = await loadEnvConfig(worktreePath);

    assert.ok(config);
    assert.equal(config?.composeFile, join(worktreePath, ".tmux-web-env", "docker-compose.yml"));
    assert.equal(config?.preRunScript, null);
    assert.equal(config?.postRunScript, null);
    assert.equal(config?.openService, null);
    assert.equal(config?.openPort, null);
  });
});

test("loadEnvConfig resolves preRunScript/postRunScript when present", async () => {
  await withWorktree(async (worktreePath) => {
    const envDir = join(worktreePath, ".tmux-web-env");
    await mkdir(envDir, { recursive: true });
    await writeFile(join(envDir, "docker-compose.yml"), "services: {}\n");
    await writeFile(join(envDir, "pre-run.sh"), "#!/bin/sh\necho pre\n");
    await writeFile(join(envDir, "post-run.sh"), "#!/bin/sh\necho post\n");

    const config = await loadEnvConfig(worktreePath);

    assert.equal(config?.preRunScript, join(envDir, "pre-run.sh"));
    assert.equal(config?.postRunScript, join(envDir, "post-run.sh"));
  });
});

test("loadEnvConfig parses openService/openPort from env.json", async () => {
  await withWorktree(async (worktreePath) => {
    const envDir = join(worktreePath, ".tmux-web-env");
    await mkdir(envDir, { recursive: true });
    await writeFile(join(envDir, "docker-compose.yml"), "services: {}\n");
    await writeFile(join(envDir, "env.json"), JSON.stringify({ openService: "web", openPort: 3000 }));

    const config = await loadEnvConfig(worktreePath);

    assert.equal(config?.openService, "web");
    assert.equal(config?.openPort, 3000);
  });
});

test("loadEnvConfig throws EnvConfigError on malformed env.json", async () => {
  await withWorktree(async (worktreePath) => {
    const envDir = join(worktreePath, ".tmux-web-env");
    await mkdir(envDir, { recursive: true });
    await writeFile(join(envDir, "docker-compose.yml"), "services: {}\n");
    await writeFile(join(envDir, "env.json"), "{ not valid json");

    await assert.rejects(() => loadEnvConfig(worktreePath), EnvConfigError);
  });
});

test("loadEnvConfig throws EnvConfigError when openService is not a string", async () => {
  await withWorktree(async (worktreePath) => {
    const envDir = join(worktreePath, ".tmux-web-env");
    await mkdir(envDir, { recursive: true });
    await writeFile(join(envDir, "docker-compose.yml"), "services: {}\n");
    await writeFile(join(envDir, "env.json"), JSON.stringify({ openService: 123 }));

    await assert.rejects(() => loadEnvConfig(worktreePath), EnvConfigError);
  });
});

test("loadEnvConfig throws EnvConfigError when openPort is not an integer", async () => {
  await withWorktree(async (worktreePath) => {
    const envDir = join(worktreePath, ".tmux-web-env");
    await mkdir(envDir, { recursive: true });
    await writeFile(join(envDir, "docker-compose.yml"), "services: {}\n");
    await writeFile(join(envDir, "env.json"), JSON.stringify({ openPort: "3000" }));

    await assert.rejects(() => loadEnvConfig(worktreePath), EnvConfigError);
  });
});
