import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRotatingLogLine, readRotatingLogLines } from "./rotating-log.ts";

async function withTempFile(fn: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-rotating-log-"));
  try {
    await fn(join(dir, "test.log"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readRotatingLogLines returns an empty array when the file doesn't exist yet", async () => {
  await withTempFile(async (filePath) => {
    assert.deepEqual(await readRotatingLogLines(filePath), []);
  });
});

test("appendRotatingLogLine writes a line and readRotatingLogLines reads it back", async () => {
  await withTempFile(async (filePath) => {
    await appendRotatingLogLine(filePath, "line-1");
    assert.deepEqual(await readRotatingLogLines(filePath), ["line-1"]);
  });
});

test("readRotatingLogLines returns newest-first order", async () => {
  await withTempFile(async (filePath) => {
    await appendRotatingLogLine(filePath, "first");
    await appendRotatingLogLine(filePath, "second");
    assert.deepEqual(await readRotatingLogLines(filePath), ["second", "first"]);
  });
});

test("readRotatingLogLines respects the limit, keeping only the most recent lines", async () => {
  await withTempFile(async (filePath) => {
    for (let i = 0; i < 5; i++) {
      await appendRotatingLogLine(filePath, `entry-${i}`);
    }
    assert.deepEqual(await readRotatingLogLines(filePath, 2), ["entry-4", "entry-3"]);
  });
});

test("appendRotatingLogLine creates parent directories that don't exist yet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-rotating-log-"));
  try {
    const filePath = join(dir, "nested", "deeper", "test.log");
    await appendRotatingLogLine(filePath, "line-1");
    assert.deepEqual(await readRotatingLogLines(filePath), ["line-1"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendRotatingLogLine rotates the file once it reaches maxSizeBytes, starting a fresh live file", async () => {
  await withTempFile(async (filePath) => {
    await appendRotatingLogLine(filePath, "old", { maxSizeBytes: 1 });
    await appendRotatingLogLine(filePath, "new", { maxSizeBytes: 1 });

    assert.deepEqual(await readRotatingLogLines(filePath), ["new"]);
    assert.equal((await readFile(`${filePath}.1`, "utf-8")).trim(), "old");
  });
});

test("appendRotatingLogLine drops the oldest generation beyond maxRotatedFiles", async () => {
  await withTempFile(async (filePath) => {
    for (const line of ["a", "b", "c", "d"]) {
      await appendRotatingLogLine(filePath, line, { maxSizeBytes: 1, maxRotatedFiles: 2 });
    }

    await assert.rejects(() => stat(`${filePath}.3`));
    assert.equal((await readFile(`${filePath}.1`, "utf-8")).trim(), "c");
    assert.equal((await readFile(`${filePath}.2`, "utf-8")).trim(), "b");
  });
});
