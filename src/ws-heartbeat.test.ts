import { test } from "node:test";
import assert from "node:assert/strict";
import { attachHeartbeat, HEARTBEAT_INTERVAL_MS, type HeartbeatSocketLike } from "./ws-heartbeat.ts";

// Drives the interval by hand so the whole suite stays synchronous -- the
// real timing (30s) is the one thing worth NOT waiting for in a test.
function fakeTimer() {
  let tick: (() => void) | null = null;
  let cleared = false;
  let requestedMs: number | null = null;
  return {
    setIntervalFn: (callback: () => void, ms: number): unknown => {
      tick = callback;
      requestedMs = ms;
      return "handle";
    },
    clearIntervalFn: (handle: unknown): void => {
      assert.equal(handle, "handle");
      cleared = true;
    },
    fire: () => tick?.(),
    get cleared() {
      return cleared;
    },
    get requestedMs() {
      return requestedMs;
    },
  };
}

function fakeSocket() {
  const listeners: Record<string, (() => void)[]> = { pong: [], close: [] };
  let pings = 0;
  let terminated = 0;
  const socket: HeartbeatSocketLike = {
    on: (event, listener) => {
      listeners[event].push(listener);
    },
    ping: () => {
      pings += 1;
    },
    terminate: () => {
      terminated += 1;
    },
  };
  return {
    socket,
    emit: (event: "pong" | "close") => {
      for (const listener of listeners[event]) listener();
    },
    get pings() {
      return pings;
    },
    get terminated() {
      return terminated;
    },
  };
}

test("attachHeartbeat pings on each interval instead of terminating a fresh socket", () => {
  const timer = fakeTimer();
  const ws = fakeSocket();

  attachHeartbeat(ws.socket, timer);

  assert.equal(timer.requestedMs, HEARTBEAT_INTERVAL_MS);
  timer.fire();
  assert.equal(ws.pings, 1, "first tick should ping, not terminate");
  assert.equal(ws.terminated, 0);
});

test("attachHeartbeat keeps a socket that answers with a pong", () => {
  const timer = fakeTimer();
  const ws = fakeSocket();

  attachHeartbeat(ws.socket, timer);

  for (let i = 0; i < 5; i += 1) {
    timer.fire();
    ws.emit("pong");
  }

  assert.equal(ws.pings, 5);
  assert.equal(ws.terminated, 0, "a ponging socket must never be terminated");
});

test("attachHeartbeat terminates a socket that misses a pong", () => {
  const timer = fakeTimer();
  const ws = fakeSocket();

  attachHeartbeat(ws.socket, timer);

  timer.fire(); // pings, marks not-alive
  timer.fire(); // no pong arrived in between -> dead

  assert.equal(ws.terminated, 1);
  assert.equal(ws.pings, 1, "a dead socket should not be pinged again");
  assert.equal(timer.cleared, true, "the interval must be cleared so it cannot leak");
});

test("attachHeartbeat terminates only once and stops ticking afterwards", () => {
  const timer = fakeTimer();
  const ws = fakeSocket();

  attachHeartbeat(ws.socket, timer);

  timer.fire();
  timer.fire();
  timer.fire();
  timer.fire();

  assert.equal(ws.terminated, 1);
});

test("attachHeartbeat stops when the socket closes on its own", () => {
  const timer = fakeTimer();
  const ws = fakeSocket();

  attachHeartbeat(ws.socket, timer);
  ws.emit("close");

  assert.equal(timer.cleared, true);

  timer.fire();
  assert.equal(ws.pings, 0, "a closed socket must not be pinged");
  assert.equal(ws.terminated, 0, "a closed socket must not be terminated again");
});

test("attachHeartbeat's returned stop function halts the heartbeat", () => {
  const timer = fakeTimer();
  const ws = fakeSocket();

  const stop = attachHeartbeat(ws.socket, timer);
  stop();
  timer.fire();

  assert.equal(timer.cleared, true);
  assert.equal(ws.pings, 0);
  assert.equal(ws.terminated, 0);
});
