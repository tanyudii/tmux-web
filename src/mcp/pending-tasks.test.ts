import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPendingTaskStore,
  getSessionStatus,
  beginWait,
  resolveHookEvent,
  failWait,
  SessionBusyError,
  TaskTimeoutError,
  type HookEvent,
} from "./pending-tasks.ts";

test("getSessionStatus returns idle for a session that has never been touched", () => {
  const store = createPendingTaskStore();
  assert.equal(getSessionStatus(store, "proj__feature"), "idle");
});

test("beginWait immediately (synchronously) transitions an idle session to busy", () => {
  const store = createPendingTaskStore();
  beginWait(store, "proj__feature", 5_000).catch(() => {});
  assert.equal(getSessionStatus(store, "proj__feature"), "busy");
});

test("beginWait throws SessionBusyError when the session is already busy", () => {
  const store = createPendingTaskStore();
  beginWait(store, "proj__feature", 5_000).catch(() => {});
  assert.throws(() => beginWait(store, "proj__feature", 5_000), SessionBusyError);
});

test("resolveHookEvent delivers to the promise returned by beginWait and returns the session to idle", async () => {
  const store = createPendingTaskStore();
  const pending = beginWait(store, "proj__feature", 5_000);

  // No await happened between beginWait and this call -- the resolver must
  // already be registered synchronously, closing the race an earlier
  // two-step (markBusy, then separately register) design left open.
  const event: HookEvent = { hookEvent: "Stop", text: "done" };
  const delivered = resolveHookEvent(store, "proj__feature", event);

  assert.equal(delivered, true);
  assert.deepEqual(await pending, event);
  assert.equal(getSessionStatus(store, "proj__feature"), "idle");
});

test("resolveHookEvent returns false when no one is waiting for that session", () => {
  const store = createPendingTaskStore();
  const delivered = resolveHookEvent(store, "unknown-session", { hookEvent: "Stop", text: "x" });
  assert.equal(delivered, false);
});

test("beginWait's promise rejects with TaskTimeoutError and returns the session to idle when the timeout elapses first", async () => {
  const store = createPendingTaskStore();
  await assert.rejects(beginWait(store, "proj__feature", 10), TaskTimeoutError);
  assert.equal(getSessionStatus(store, "proj__feature"), "idle");
});

test("a late hook event (after timeout already fired) is dropped, not delivered to a new waiter", async () => {
  const store = createPendingTaskStore();
  await assert.rejects(beginWait(store, "proj__feature", 10), TaskTimeoutError);

  // Session is idle again -- a stray resolveHookEvent from the earlier
  // (already-timed-out) hook call must not be delivered to anyone.
  const delivered = resolveHookEvent(store, "proj__feature", { hookEvent: "Stop", text: "late" });
  assert.equal(delivered, false);
});

test("failWait rejects the pending promise with the given error and returns the session to idle, without waiting for the timeout", async () => {
  const store = createPendingTaskStore();
  const pending = beginWait(store, "proj__feature", 60_000);

  failWait(store, "proj__feature", new Error("sendKeys failed"));

  await assert.rejects(pending, /sendKeys failed/);
  assert.equal(getSessionStatus(store, "proj__feature"), "idle");
});

test("failWait on a session with no pending wait just ensures it is idle, without throwing", () => {
  const store = createPendingTaskStore();
  assert.doesNotThrow(() => failWait(store, "never-started", new Error("x")));
  assert.equal(getSessionStatus(store, "never-started"), "idle");
});

test("after failWait, a new beginWait for the same session succeeds immediately (not stuck busy)", async () => {
  const store = createPendingTaskStore();
  const first = beginWait(store, "proj__feature", 60_000);
  failWait(store, "proj__feature", new Error("boom"));
  await assert.rejects(first);

  const second = beginWait(store, "proj__feature", 5_000);
  resolveHookEvent(store, "proj__feature", { hookEvent: "Stop", text: "ok" });
  assert.deepEqual(await second, { hookEvent: "Stop", text: "ok" });
});
