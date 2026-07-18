import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listEnvFiles,
  readEnvFile,
  writeEnvFile,
  EnvEditorError,
  EnvFileNotFoundError,
  EnvFileValidationError,
} from "./env-editor.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "env-editor-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readEnvFile rejects a filename that isn't on the allowlist", async () => {
  await assert.rejects(() => readEnvFile("/repo", "../../../etc/passwd"), EnvEditorError);
});

test("readEnvFile throws EnvFileNotFoundError when the file doesn't exist", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(() => readEnvFile(dir, "docker-compose.yml"), EnvFileNotFoundError);
  });
});

test("readEnvFile returns the file's content", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".tmux-web-env"), { recursive: true });
    await writeFile(join(dir, ".tmux-web-env", "env.json"), '{"open":[]}');
    assert.equal(await readEnvFile(dir, "env.json"), '{"open":[]}');
  });
});

test("listEnvFiles only returns files that actually exist", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".tmux-web-env"), { recursive: true });
    await writeFile(join(dir, ".tmux-web-env", "docker-compose.yml"), "services: {}\n");
    await writeFile(join(dir, ".tmux-web-env", "pre-run.sh"), "#!/bin/sh\necho hi\n");

    const files = await listEnvFiles(dir);

    assert.deepEqual(
      files.map((f) => f.filename).sort(),
      ["docker-compose.yml", "pre-run.sh"],
    );
  });
});

test("writeEnvFile rejects a filename that isn't on the allowlist", async () => {
  await assert.rejects(() => writeEnvFile("/repo", "not-allowed.txt", "x"), EnvEditorError);
});

test("writeEnvFile validates env.json as JSON before writing (fake exec, no real docker needed)", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".tmux-web-env"), { recursive: true });
    const fakeExec = async () => {
      throw new Error("exec must not be called for env.json validation");
    };

    await assert.rejects(() => writeEnvFile(dir, "env.json", "{not json", fakeExec), EnvFileValidationError);

    await writeEnvFile(dir, "env.json", '{"open":[]}', fakeExec);
    assert.equal(await readFile(join(dir, ".tmux-web-env", "env.json"), "utf-8"), '{"open":[]}');
  });
});

test("writeEnvFile rejects an invalid docker-compose.yml without touching the real file (fake exec)", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".tmux-web-env"), { recursive: true });
    await writeFile(join(dir, ".tmux-web-env", "docker-compose.yml"), "services:\n  web: {}\n");
    const fakeExec = async () => {
      const err = new Error("Command failed") as Error & { stderr?: string };
      err.stderr = "yaml: line 2: mapping values are not allowed in this context";
      throw err;
    };

    await assert.rejects(
      () => writeEnvFile(dir, "docker-compose.yml", "services:\n  web bad yaml", fakeExec),
      EnvFileValidationError,
    );

    const stillOriginal = await readFile(join(dir, ".tmux-web-env", "docker-compose.yml"), "utf-8");
    assert.equal(stillOriginal, "services:\n  web: {}\n");
  });
});

test("writeEnvFile rejects an invalid shell script without touching the real file (fake exec)", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".tmux-web-env"), { recursive: true });
    await writeFile(join(dir, ".tmux-web-env", "pre-run.sh"), "#!/bin/sh\necho original\n");
    const fakeExec = async () => {
      const err = new Error("Command failed") as Error & { stderr?: string };
      err.stderr = "sh: line 2: syntax error: unexpected end of file";
      throw err;
    };

    await assert.rejects(
      () => writeEnvFile(dir, "pre-run.sh", "#!/bin/sh\nif [ 1 -eq 1 ]; then\n", fakeExec),
      EnvFileValidationError,
    );

    const stillOriginal = await readFile(join(dir, ".tmux-web-env", "pre-run.sh"), "utf-8");
    assert.equal(stillOriginal, "#!/bin/sh\necho original\n");
  });
});

function isGitAvailable(): boolean {
  // Reused as a general "is a real shell/toolchain available" probe, same
  // as the other *.test.ts files in this repo.
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test(
  "real process integration: writeEnvFile validates pre-run.sh with a real /bin/sh -n",
  { skip: !isGitAvailable() },
  async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, ".tmux-web-env"), { recursive: true });

      await writeEnvFile(dir, "pre-run.sh", "#!/bin/sh\necho hello\n");
      assert.equal(
        await readFile(join(dir, ".tmux-web-env", "pre-run.sh"), "utf-8"),
        "#!/bin/sh\necho hello\n",
      );

      await assert.rejects(
        () => writeEnvFile(dir, "pre-run.sh", "#!/bin/sh\nif [ 1 -eq 1 ]; then\n"),
        EnvFileValidationError,
      );
      // Real, unmocked sh -n rejected it -- the file on disk must be unchanged.
      assert.equal(
        await readFile(join(dir, ".tmux-web-env", "pre-run.sh"), "utf-8"),
        "#!/bin/sh\necho hello\n",
      );
    });
  },
);

function isDockerAvailable(): boolean {
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test(
  "real process integration: writeEnvFile validates docker-compose.yml with the real docker compose binary",
  { skip: !isDockerAvailable() },
  async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, ".tmux-web-env"), { recursive: true });

      await writeEnvFile(dir, "docker-compose.yml", "services:\n  web:\n    image: nginx\n");
      assert.match(
        await readFile(join(dir, ".tmux-web-env", "docker-compose.yml"), "utf-8"),
        /image: nginx/,
      );

      await assert.rejects(
        () => writeEnvFile(dir, "docker-compose.yml", "services:\n  web bad yaml here"),
        EnvFileValidationError,
      );
      assert.match(
        await readFile(join(dir, ".tmux-web-env", "docker-compose.yml"), "utf-8"),
        /image: nginx/,
      );
    });
  },
);

