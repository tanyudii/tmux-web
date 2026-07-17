import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAccessLogEntry, readAccessLog, type AccessLogEntry } from "./access-log.ts";

async function withTempFile(fn: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-access-log-"));
  try {
    await fn(join(dir, "access.log"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function entry(overrides: Partial<AccessLogEntry> = {}): AccessLogEntry {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    ip: "203.0.113.5",
    method: "GET",
    path: "/api/projects",
    outcome: "authorized",
    ...overrides,
  };
}

test("readAccessLog returns an empty array when the file doesn't exist yet", async () => {
  await withTempFile(async (filePath) => {
    assert.deepEqual(await readAccessLog(filePath), []);
  });
});

test("appendAccessLogEntry writes a JSON line and readAccessLog reads it back", async () => {
  await withTempFile(async (filePath) => {
    await appendAccessLogEntry(filePath, entry());
    assert.deepEqual(await readAccessLog(filePath), [entry()]);
  });
});

test("readAccessLog returns newest-first order", async () => {
  await withTempFile(async (filePath) => {
    await appendAccessLogEntry(filePath, entry({ path: "/first" }));
    await appendAccessLogEntry(filePath, entry({ path: "/second" }));
    const result = await readAccessLog(filePath);
    assert.deepEqual(result.map((e) => e.path), ["/second", "/first"]);
  });
});

test("readAccessLog respects the limit, keeping only the most recent entries", async () => {
  await withTempFile(async (filePath) => {
    for (let i = 0; i < 5; i++) {
      await appendAccessLogEntry(filePath, entry({ path: `/entry-${i}` }));
    }
    const result = await readAccessLog(filePath, 2);
    assert.deepEqual(result.map((e) => e.path), ["/entry-4", "/entry-3"]);
  });
});

test("appendAccessLogEntry records both authorized and denied outcomes", async () => {
  await withTempFile(async (filePath) => {
    await appendAccessLogEntry(filePath, entry({ outcome: "authorized" }));
    await appendAccessLogEntry(filePath, entry({ outcome: "denied" }));
    const result = await readAccessLog(filePath);
    assert.deepEqual(result.map((e) => e.outcome), ["denied", "authorized"]);
  });
});

test("appendAccessLogEntry creates parent directories that don't exist yet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-access-log-"));
  try {
    const filePath = join(dir, "nested", "deeper", "access.log");
    await appendAccessLogEntry(filePath, entry());
    assert.deepEqual(await readAccessLog(filePath), [entry()]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendAccessLogEntry rotates the file once it reaches maxSizeBytes, starting a fresh live file", async () => {
  await withTempFile(async (filePath) => {
    // First entry establishes a non-empty file; the second append sees the
    // file already at/over the tiny maxSizeBytes threshold and rotates
    // *before* writing, so the live file ends up containing only the entry
    // that triggered rotation.
    await appendAccessLogEntry(filePath, entry({ path: "/old" }), { maxSizeBytes: 1 });
    await appendAccessLogEntry(filePath, entry({ path: "/new" }), { maxSizeBytes: 1 });

    const live = await readAccessLog(filePath);
    assert.deepEqual(live.map((e) => e.path), ["/new"]);

    const rotated = JSON.parse((await readFile(`${filePath}.1`, "utf-8")).trim()) as AccessLogEntry;
    assert.equal(rotated.path, "/old");
  });
});

test("appendAccessLogEntry drops the oldest generation beyond maxRotatedFiles", async () => {
  await withTempFile(async (filePath) => {
    // Every append after the first rotates (maxSizeBytes: 1), so with
    // maxRotatedFiles: 2 the oldest of 3 rotations must be gone afterward.
    for (const path of ["/a", "/b", "/c", "/d"]) {
      await appendAccessLogEntry(filePath, entry({ path }), { maxSizeBytes: 1, maxRotatedFiles: 2 });
    }

    await assert.rejects(() => stat(`${filePath}.3`));
    const gen1 = JSON.parse((await readFile(`${filePath}.1`, "utf-8")).trim()) as AccessLogEntry;
    const gen2 = JSON.parse((await readFile(`${filePath}.2`, "utf-8")).trim()) as AccessLogEntry;
    assert.equal(gen1.path, "/c");
    assert.equal(gen2.path, "/b");
  });
});
