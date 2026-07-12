import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ServerDeps } from "./server.ts";
import { ValidationError } from "./tmux.ts";
import { ProjectValidationError, type Project } from "./projects.ts";
import { WorktreeConflictError, DirtyWorktreeError } from "./worktree.ts";

const TOKEN = "test-token-123";

const SAMPLE_PROJECT: Project = {
  id: "proj1-ab12cd",
  name: "My Project",
  repoPath: "/repo",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function makeDeps(overrides: Partial<ServerDeps> = {}): ServerDeps {
  return {
    token: TOKEN,
    listProjects: async () => [SAMPLE_PROJECT],
    registerProject: async (name: string, repoPath: string) => ({
      id: "new-id",
      name,
      repoPath,
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    getProject: async (id: string) => (id === SAMPLE_PROJECT.id ? SAMPLE_PROJECT : undefined),
    removeProject: async () => {},
    listProjectSessions: async () => [],
    createProjectSession: async (_project: Project, name: string) => ({
      name,
      fullName: `${SAMPLE_PROJECT.id}__${name}`,
      windows: 1,
      attached: false,
    }),
    killProjectSession: async () => {},
    ...overrides,
  };
}

async function withServer(deps: ServerDeps, fn: (baseUrl: string) => Promise<void>): Promise<void> {
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

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

// --- Projects ---

test("GET /api/projects without a token returns 401", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects`);
    assert.equal(res.status, 401);
  });
});

test("GET /api/projects with the correct token returns the project list", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { projects: [SAMPLE_PROJECT] });
  });
});

test("POST /api/projects creates a project and returns 201", async () => {
  const calls: Array<{ name: string; repoPath: string }> = [];
  const deps = makeDeps({
    registerProject: async (name: string, repoPath: string) => {
      calls.push({ name, repoPath });
      return { id: "new-id", name, repoPath, createdAt: "2026-01-01T00:00:00.000Z" };
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "New Project", repoPath: "/abs/repo" }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(calls, [{ name: "New Project", repoPath: "/abs/repo" }]);
  });
});

test("POST /api/projects returns 400 when registration is rejected (ProjectValidationError)", async () => {
  const deps = makeDeps({
    registerProject: async () => {
      throw new ProjectValidationError("Not a git repository");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "New Project", repoPath: "/not/a/repo" }),
    });
    assert.equal(res.status, 400);
  });
});

test("DELETE /api/projects/:id removes the project when it has no active sessions", async () => {
  const calls: string[] = [];
  const deps = makeDeps({ removeProject: async (id: string) => { calls.push(id); } });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(res.status, 204);
    assert.deepEqual(calls, [SAMPLE_PROJECT.id]);
  });
});

test("DELETE /api/projects/:id returns 409 when the project has active sessions and force is not set", async () => {
  let called = false;
  const deps = makeDeps({
    listProjectSessions: async () => [{ name: "main", fullName: "x__main", windows: 1, attached: false }],
    removeProject: async () => { called = true; },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(res.status, 409);
    assert.equal(called, false);
  });
});

test("DELETE /api/projects/:id?force=true removes the project despite active sessions", async () => {
  const deps = makeDeps({
    listProjectSessions: async () => [{ name: "main", fullName: "x__main", windows: 1, attached: false }],
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}?force=true`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(res.status, 204);
  });
});

test("DELETE /api/projects/:id returns 404 for an unknown project", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/unknown-id`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(res.status, 404);
  });
});

// --- Project sessions ---

test("GET /api/projects/:id/sessions returns the session list", async () => {
  const deps = makeDeps({
    listProjectSessions: async () => [{ name: "main", fullName: "proj1-ab12cd__main", windows: 1, attached: false }],
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      sessions: [{ name: "main", fullName: "proj1-ab12cd__main", windows: 1, attached: false }],
    });
  });
});

test("GET /api/projects/:id/sessions returns 404 for an unknown project", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/unknown-id/sessions`, { headers: authHeaders() });
    assert.equal(res.status, 404);
  });
});

test("POST /api/projects/:id/sessions creates a session and returns 201", async () => {
  const calls: Array<{ projectId: string; name: string }> = [];
  const deps = makeDeps({
    createProjectSession: async (project: Project, name: string) => {
      calls.push({ projectId: project.id, name });
      return { name, fullName: `${project.id}__${name}`, windows: 1, attached: false };
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "Feature X" }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(calls, [{ projectId: SAMPLE_PROJECT.id, name: "Feature X" }]);
  });
});

test("POST /api/projects/:id/sessions returns 400 for a ValidationError", async () => {
  const deps = makeDeps({
    createProjectSession: async () => {
      throw new ValidationError("no usable characters");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "!!!" }),
    });
    assert.equal(res.status, 400);
  });
});

test("POST /api/projects/:id/sessions returns 409 for a WorktreeConflictError", async () => {
  const deps = makeDeps({
    createProjectSession: async () => {
      throw new WorktreeConflictError("branch already exists");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "feature-x" }),
    });
    assert.equal(res.status, 409);
  });
});

test("POST /api/projects/:id/sessions returns 404 for an unknown project", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/unknown-id/sessions`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "feature-x" }),
    });
    assert.equal(res.status, 404);
  });
});

test("DELETE /api/projects/:id/sessions/:name kills the session and returns 204", async () => {
  const calls: Array<{ projectId: string; slug: string; force: boolean }> = [];
  const deps = makeDeps({
    killProjectSession: async (project: Project, slug: string, options: { force?: boolean }) => {
      calls.push({ projectId: project.id, slug, force: Boolean(options.force) });
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(res.status, 204);
    assert.deepEqual(calls, [{ projectId: SAMPLE_PROJECT.id, slug: "feature-x", force: false }]);
  });
});

test("DELETE /api/projects/:id/sessions/:name?force=true passes force through", async () => {
  const calls: boolean[] = [];
  const deps = makeDeps({
    killProjectSession: async (_project: Project, _slug: string, options: { force?: boolean }) => {
      calls.push(Boolean(options.force));
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x?force=true`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(res.status, 204);
    assert.deepEqual(calls, [true]);
  });
});

test("DELETE /api/projects/:id/sessions/:name returns 409 for a DirtyWorktreeError", async () => {
  const deps = makeDeps({
    killProjectSession: async () => {
      throw new DirtyWorktreeError("contains modified or untracked files");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(res.status, 409);
  });
});

test("DELETE /api/projects/:id/sessions/:name returns 404 for an unknown project", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/unknown-id/sessions/feature-x`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(res.status, 404);
  });
});

test("project routes without a token return 401 and never call into deps", async () => {
  let called = false;
  const deps = makeDeps({ listProjectSessions: async () => { called = true; return []; } });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions`);
    assert.equal(res.status, 401);
    assert.equal(called, false);
  });
});

// --- Static files + 404 (unchanged behavior) ---

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
    const res = await fetch(`${baseUrl}/does-not-exist`, { headers: authHeaders() });
    assert.equal(res.status, 404);
  });
});
