import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSessionEvent, readSessionEvents, type SessionEvent, type SessionEventType } from "./session-events.ts";

async function withTempFile(fn: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-session-events-"));
  try {
    await fn(join(dir, "p1.jsonl"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function event(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    projectId: "p1",
    sessionSlug: "feature-x",
    type: "created",
    ...overrides,
  };
}

test("readSessionEvents returns an empty array when the file doesn't exist yet", async () => {
  await withTempFile(async (filePath) => {
    assert.deepEqual(await readSessionEvents(filePath, "feature-x"), []);
  });
});

test("appendSessionEvent writes an event and readSessionEvents reads it back", async () => {
  await withTempFile(async (filePath) => {
    await appendSessionEvent(filePath, event());
    assert.deepEqual(await readSessionEvents(filePath, "feature-x"), [event()]);
  });
});

test("readSessionEvents returns newest-first order for the full lifecycle", async () => {
  await withTempFile(async (filePath) => {
    const lifecycle: SessionEventType[] = ["created", "env_setup_started", "env_setup_finished", "env_stopped", "deleted"];
    for (const type of lifecycle) {
      await appendSessionEvent(filePath, event({ type }));
    }

    const result = await readSessionEvents(filePath, "feature-x");
    assert.deepEqual(result.map((e) => e.type), [...lifecycle].reverse());
  });
});

test("readSessionEvents filters to only the requested session, even when other sessions' events are more recent", async () => {
  await withTempFile(async (filePath) => {
    await appendSessionEvent(filePath, event({ sessionSlug: "feature-x", type: "created" }));
    // A busier sibling session's events interleave and are more recent --
    // must not crowd feature-x's history out of the result.
    for (let i = 0; i < 10; i++) {
      await appendSessionEvent(filePath, event({ sessionSlug: "feature-y", type: "env_setup_started" }));
    }
    await appendSessionEvent(filePath, event({ sessionSlug: "feature-x", type: "deleted" }));

    const result = await readSessionEvents(filePath, "feature-x");
    assert.deepEqual(result.map((e) => e.type), ["deleted", "created"]);
    assert.ok(result.every((e) => e.sessionSlug === "feature-x"));
  });
});

test("readSessionEvents respects the limit", async () => {
  await withTempFile(async (filePath) => {
    for (let i = 0; i < 5; i++) {
      await appendSessionEvent(filePath, event({ message: `event-${i}` }));
    }
    const result = await readSessionEvents(filePath, "feature-x", 2);
    assert.deepEqual(result.map((e) => e.message), ["event-4", "event-3"]);
  });
});

test("appendSessionEvent records an optional message", async () => {
  await withTempFile(async (filePath) => {
    await appendSessionEvent(filePath, event({ type: "env_setup_failed", message: "docker compose up failed" }));
    const result = await readSessionEvents(filePath, "feature-x");
    assert.equal(result[0].message, "docker compose up failed");
  });
});
