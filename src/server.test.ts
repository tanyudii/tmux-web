import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createServer, type ServerDeps } from "./server.ts";
import { ValidationError, type TmuxSession } from "./tmux.ts";

const TOKEN = "test-token-123";

function makeDeps(overrides: Partial<ServerDeps> = {}): ServerDeps {
  return {
    token: TOKEN,
    listSessions: async () => [{ name: "main", windows: 1, attached: false }] as TmuxSession[],
    createSession: async () => {},
    killSession: async () => {},
    ...overrides,
  };
}

async function withServer(
  deps: ServerDeps,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer(deps);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected server to bind to a TCP port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("GET /api/sessions without a token returns 401", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(res.status, 401);
  });
});

test("GET /api/sessions with the wrong token returns 401", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    assert.equal(res.status, 401);
  });
});

test("GET /api/sessions with the correct token returns the session list", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { sessions: [{ name: "main", windows: 1, attached: false }] });
  });
});

test("POST /api/sessions creates a session and returns 201", async () => {
  const created: string[] = [];
  const deps = makeDeps({
    createSession: async (name: string) => {
      created.push(name);
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "scratch" }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(created, ["scratch"]);
  });
});

test("POST /api/sessions with an invalid name returns 400", async () => {
  const deps = makeDeps({
    createSession: async () => {
      throw new ValidationError("Invalid session name");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bad name" }),
    });
    assert.equal(res.status, 400);
  });
});

test("POST /api/sessions with malformed JSON returns 400", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: "{not json",
    });
    assert.equal(res.status, 400);
  });
});

test("POST /api/sessions without a token returns 401 and does not create a session", async () => {
  let called = false;
  const deps = makeDeps({
    createSession: async () => {
      called = true;
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "scratch" }),
    });
    assert.equal(res.status, 401);
    assert.equal(called, false);
  });
});

test("DELETE /api/sessions/:name kills the named session and returns 204", async () => {
  const killed: string[] = [];
  const deps = makeDeps({
    killSession: async (name: string) => {
      killed.push(name);
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sessions/main`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 204);
    assert.deepEqual(killed, ["main"]);
  });
});

test("DELETE /api/sessions/:name with an invalid name returns 400", async () => {
  const deps = makeDeps({
    killSession: async () => {
      throw new ValidationError("Invalid session name");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent("bad name")}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 400);
  });
});

test("unknown routes return 404", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/does-not-exist`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 404);
  });
});
