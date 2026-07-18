import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createHookListener } from "./hook-listener.ts";

const SECRET = "test-secret-0123456789abcdef";

function authHeaders(secret: string = SECRET): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${secret}` };
}

async function withListener(
  onHookEvent: (session: string, event: { hookEvent: "Stop" | "Notification"; text: string }) => void,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server: Server = createHookListener({ onHookEvent, expectedSecret: SECRET });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("POST /hook with a valid payload and a correct secret calls onHookEvent and returns 204", async () => {
  const received: Array<{ session: string; event: unknown }> = [];
  await withListener(
    (session, event) => received.push({ session, event }),
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/hook`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ session: "proj__feature", hookEvent: "Stop", text: "pane output" }),
      });
      assert.equal(res.status, 204);
      assert.deepEqual(received, [
        { session: "proj__feature", event: { hookEvent: "Stop", text: "pane output" } },
      ]);
    },
  );
});

test("POST /hook with a missing or wrong secret returns 401 and does not call onHookEvent", async () => {
  let called = false;
  await withListener(
    () => {
      called = true;
    },
    async (baseUrl) => {
      const noAuth = await fetch(`${baseUrl}/hook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: "s", hookEvent: "Stop", text: "x" }),
      });
      assert.equal(noAuth.status, 401);

      const wrongAuth = await fetch(`${baseUrl}/hook`, {
        method: "POST",
        headers: authHeaders("wrong-secret"),
        body: JSON.stringify({ session: "s", hookEvent: "Stop", text: "x" }),
      });
      assert.equal(wrongAuth.status, 401);
      assert.equal(called, false);
    },
  );
});

test("POST /hook with a missing session returns 400 and does not call onHookEvent", async () => {
  let called = false;
  await withListener(
    () => {
      called = true;
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/hook`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ hookEvent: "Stop", text: "x" }),
      });
      assert.equal(res.status, 400);
      assert.equal(called, false);
    },
  );
});

test("POST /hook with an invalid hookEvent value returns 400", async () => {
  await withListener(
    () => {},
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/hook`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ session: "s", hookEvent: "Bogus", text: "x" }),
      });
      assert.equal(res.status, 400);
    },
  );
});

test("GET /hook is not found -- only POST is accepted", async () => {
  await withListener(
    () => {},
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/hook`);
      assert.equal(res.status, 404);
    },
  );
});

test("an unknown path returns 404", async () => {
  await withListener(
    () => {},
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/whatever`, { method: "POST", headers: authHeaders() });
      assert.equal(res.status, 404);
    },
  );
});
