import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("POST /api/sessions with a missing name field returns 400", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

test("POST /api/sessions propagates unexpected (non-validation) errors as 500", async () => {
  const deps = makeDeps({
    createSession: async () => {
      throw new Error("tmux binary not found");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "main" }),
    });
    assert.equal(res.status, 500);
  });
});

test("DELETE /api/sessions/:name propagates unexpected (non-validation) errors as 500", async () => {
  const deps = makeDeps({
    killSession: async () => {
      throw new Error("tmux binary not found");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sessions/main`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 500);
  });
});

test("serves static files from publicDir, defaulting '/' to index.html", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-public-"));
  await writeFile(join(dir, "index.html"), "<html>hi</html>");
  try {
    await withServer(makeDeps({ publicDir: dir }), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/`);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "<html>hi</html>");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("returns 404 for a path-traversal attempt against publicDir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-public-"));
  await writeFile(join(dir, "index.html"), "<html>hi</html>");
  try {
    await withServer(makeDeps({ publicDir: dir }), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/../../../../etc/passwd`);
      assert.equal(res.status, 404);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("returns 404 for a nonexistent static file under publicDir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-public-"));
  try {
    await withServer(makeDeps({ publicDir: dir }), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/does-not-exist.js`);
      assert.equal(res.status, 404);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unknown routes return 404", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/does-not-exist`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 404);
  });
});
