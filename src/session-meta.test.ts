import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSessionMeta, saveSessionMeta, listProjectSessionMeta, setSessionMeta, type SessionMeta } from "./session-meta.ts";

async function withTempFile(fn: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-session-meta-"));
  try {
    await fn(join(dir, "session-meta.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadSessionMeta returns an empty array when the file doesn't exist yet", async () => {
  await withTempFile(async (filePath) => {
    assert.deepEqual(await loadSessionMeta(filePath), []);
  });
});

test("loadSessionMeta returns an empty array for a malformed (non-array) file", async () => {
  await withTempFile(async (filePath) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, JSON.stringify({ not: "an array" }));
    assert.deepEqual(await loadSessionMeta(filePath), []);
  });
});

test("saveSessionMeta writes entries and loadSessionMeta reads them back", async () => {
  await withTempFile(async (filePath) => {
    const entries: SessionMeta[] = [{ projectId: "p1", sessionSlug: "feature-a", label: "Important", favorite: true }];
    await saveSessionMeta(filePath, entries);
    assert.deepEqual(await loadSessionMeta(filePath), entries);
  });
});

test("saveSessionMeta leaves no leftover temp file after a successful write", async () => {
  await withTempFile(async (filePath) => {
    await saveSessionMeta(filePath, []);
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(filePath, ".."));
    assert.deepEqual(files, ["session-meta.json"]);
  });
});

test("listProjectSessionMeta filters entries by projectId", async () => {
  await withTempFile(async (filePath) => {
    await saveSessionMeta(filePath, [
      { projectId: "p1", sessionSlug: "a", favorite: true },
      { projectId: "p2", sessionSlug: "b", favorite: true },
    ]);
    const result = await listProjectSessionMeta(filePath, "p1");
    assert.deepEqual(result.map((entry) => entry.sessionSlug), ["a"]);
  });
});

test("setSessionMeta creates a new entry with a normalized label", async () => {
  await withTempFile(async (filePath) => {
    const result = await setSessionMeta(filePath, "p1", "feature-a", "  Important  ", true);
    assert.deepEqual(result, { projectId: "p1", sessionSlug: "feature-a", label: "Important", favorite: true });
    assert.deepEqual(await listProjectSessionMeta(filePath, "p1"), [result]);
  });
});

test("setSessionMeta normalizes an empty/whitespace-only label to undefined", async () => {
  await withTempFile(async (filePath) => {
    const result = await setSessionMeta(filePath, "p1", "feature-a", "   ", true);
    assert.equal(result.label, undefined);
  });
});

test("setSessionMeta does not persist an entry for the all-default case (no label, not favorite)", async () => {
  await withTempFile(async (filePath) => {
    const result = await setSessionMeta(filePath, "p1", "feature-a", undefined, false);
    assert.deepEqual(result, { projectId: "p1", sessionSlug: "feature-a", label: undefined, favorite: false });
    assert.deepEqual(await loadSessionMeta(filePath), []);
  });
});

test("setSessionMeta updates an existing entry in place", async () => {
  await withTempFile(async (filePath) => {
    await setSessionMeta(filePath, "p1", "feature-a", "First", false);
    const updated = await setSessionMeta(filePath, "p1", "feature-a", "Second", true);
    assert.deepEqual(updated, { projectId: "p1", sessionSlug: "feature-a", label: "Second", favorite: true });
    assert.deepEqual(await listProjectSessionMeta(filePath, "p1"), [updated]);
  });
});

test("setSessionMeta removes an existing entry when reset back to the default", async () => {
  await withTempFile(async (filePath) => {
    await setSessionMeta(filePath, "p1", "feature-a", "Important", true);
    await setSessionMeta(filePath, "p1", "feature-a", undefined, false);
    assert.deepEqual(await listProjectSessionMeta(filePath, "p1"), []);
  });
});

test("setSessionMeta only affects the matching projectId+sessionSlug pair", async () => {
  await withTempFile(async (filePath) => {
    await setSessionMeta(filePath, "p1", "feature-a", "Keep me", true);
    await setSessionMeta(filePath, "p1", "feature-b", "Also keep me", true);
    await setSessionMeta(filePath, "p1", "feature-a", undefined, false);
    const remaining = await listProjectSessionMeta(filePath, "p1");
    assert.deepEqual(remaining.map((entry) => entry.sessionSlug), ["feature-b"]);
  });
});

test("setSessionMeta treats the same sessionSlug in a different project as a distinct entry", async () => {
  await withTempFile(async (filePath) => {
    await setSessionMeta(filePath, "p1", "feature-a", "In p1", true);
    await setSessionMeta(filePath, "p2", "feature-a", "In p2", true);
    assert.equal((await listProjectSessionMeta(filePath, "p1"))[0]?.label, "In p1");
    assert.equal((await listProjectSessionMeta(filePath, "p2"))[0]?.label, "In p2");
  });
});
