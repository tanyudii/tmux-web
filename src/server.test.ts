import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { request as httpRequest } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ServerDeps } from "./server.ts";
import { ValidationError } from "./tmux.ts";
import { ProjectValidationError, type Project } from "./projects.ts";
import { WorktreeConflictError, DirtyWorktreeError } from "./worktree.ts";
import { WorktreeNotFoundError, GitStatusError, type GroupedChanges } from "./git-status.ts";
import { EnvUnavailableError, EnvAlreadyRunningError, EnvNotRunningError, type EnvStatus } from "./session-env.ts";
import { EnvConfigError } from "./env-config.ts";
import { SessionCreationNotFoundError, type SessionCreationStatus } from "./project-sessions.ts";
import {
  InvalidDirectoryPathError,
  DirectoryNotFoundError,
  DirectoryAccessDeniedError,
  type DirectoryListing,
} from "./directory-browser.ts";

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
    browseDirectory: async (path?: string) => ({
      path: path ?? "/home/user",
      parentPath: "/home",
      isGitRepo: false,
      entries: [],
      truncated: false,
    }),
    listProjectSessions: async () => [],
    startProjectSessionCreation: async (_project: Project, name: string) => ({
      name,
      fullName: `${SAMPLE_PROJECT.id}__${name}`,
    }),
    getProjectSessionCreationStatus: async () => ({ phase: "creating" }),
    killProjectSession: async () => {},
    getProjectSessionChanges: async () => ({ staged: [], unstaged: [], untracked: [] }),
    getProjectSessionDiff: async () => ({ diff: "", isUntracked: false, isBinary: false }),
    getProjectSessionEnvStatus: async () => ({ phase: "unavailable" }),
    startProjectSessionEnv: async () => {},
    stopProjectSessionEnv: async () => {},
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

test("POST /api/projects with malformed JSON returns 400", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: "{not json",
    });
    assert.equal(res.status, 400);
  });
});

test("POST /api/projects with a missing name or repoPath returns 400", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "Only Name" }),
    });
    assert.equal(res.status, 400);
  });
});

test("POST /api/projects propagates an unexpected registerProject error as 500", async () => {
  const deps = makeDeps({
    registerProject: async () => {
      throw new Error("disk full");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "New Project", repoPath: "/abs/repo" }),
    });
    assert.equal(res.status, 500);
  });
});

// --- Browse ---

test("GET /api/browse without a token returns 401", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/browse`);
    assert.equal(res.status, 401);
  });
});

test("GET /api/browse forwards the path query param and returns the listing", async () => {
  const calls: Array<string | undefined> = [];
  const listing: DirectoryListing = {
    path: "/home/user/projects",
    parentPath: "/home/user",
    isGitRepo: false,
    entries: [{ name: "tmux-web", path: "/home/user/projects/tmux-web", isGitRepo: true }],
    truncated: false,
  };
  const deps = makeDeps({
    browseDirectory: async (path) => {
      calls.push(path);
      return listing;
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/browse?path=${encodeURIComponent("/home/user/projects")}`, {
      headers: authHeaders(),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), listing);
    assert.deepEqual(calls, ["/home/user/projects"]);
  });
});

test("GET /api/browse without a path query param passes undefined through", async () => {
  const calls: Array<string | undefined> = [];
  const deps = makeDeps({
    browseDirectory: async (path) => {
      calls.push(path);
      return { path: "/home/user", parentPath: "/home", isGitRepo: false, entries: [], truncated: false };
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/browse`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    assert.deepEqual(calls, [undefined]);
  });
});

test("GET /api/browse returns 400 for InvalidDirectoryPathError", async () => {
  const deps = makeDeps({
    browseDirectory: async () => {
      throw new InvalidDirectoryPathError("path must be an absolute path");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/browse?path=relative`, { headers: authHeaders() });
    assert.equal(res.status, 400);
  });
});

test("GET /api/browse returns 404 for DirectoryNotFoundError", async () => {
  const deps = makeDeps({
    browseDirectory: async () => {
      throw new DirectoryNotFoundError("Directory not found");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/browse?path=/nope`, { headers: authHeaders() });
    assert.equal(res.status, 404);
  });
});

test("GET /api/browse returns 403 for DirectoryAccessDeniedError", async () => {
  const deps = makeDeps({
    browseDirectory: async () => {
      throw new DirectoryAccessDeniedError("Permission denied");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/browse?path=/root`, { headers: authHeaders() });
    assert.equal(res.status, 403);
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

test("POST /api/projects/:id/sessions starts session creation and returns 202", async () => {
  const calls: Array<{ projectId: string; name: string }> = [];
  const deps = makeDeps({
    startProjectSessionCreation: async (project: Project, name: string) => {
      calls.push({ projectId: project.id, name });
      return { name, fullName: `${project.id}__${name}` };
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "Feature X" }),
    });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), {
      name: "Feature X",
      fullName: `${SAMPLE_PROJECT.id}__Feature X`,
      phase: "creating",
    });
    assert.deepEqual(calls, [{ projectId: SAMPLE_PROJECT.id, name: "Feature X" }]);
  });
});

test("POST /api/projects/:id/sessions returns 400 for a ValidationError", async () => {
  const deps = makeDeps({
    startProjectSessionCreation: async () => {
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
    startProjectSessionCreation: async () => {
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

test("POST /api/projects/:id/sessions with malformed JSON returns 400", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: "{not json",
    });
    assert.equal(res.status, 400);
  });
});

test("POST /api/projects/:id/sessions propagates an unexpected error as 500", async () => {
  const deps = makeDeps({
    startProjectSessionCreation: async () => {
      throw new Error("git binary not found");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "feature-x" }),
    });
    assert.equal(res.status, 500);
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

test("DELETE /api/projects/:id/sessions/:name propagates an unexpected error as 500", async () => {
  const deps = makeDeps({
    killProjectSession: async () => {
      throw new Error("permission denied");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(res.status, 500);
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

test("GET /api/projects/:id/sessions/:name/creation without a token returns 401", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/creation`);
    assert.equal(res.status, 401);
  });
});

test("GET /api/projects/:id/sessions/:name/creation returns the current status", async () => {
  const status: SessionCreationStatus = { phase: "creating", message: "Creating worktree…" };
  const deps = makeDeps({ getProjectSessionCreationStatus: async () => status });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/creation`, {
      headers: authHeaders(),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), status);
  });
});

test("GET /api/projects/:id/sessions/:name/creation returns 404 when nothing is tracked for that slug (SessionCreationNotFoundError)", async () => {
  const deps = makeDeps({
    getProjectSessionCreationStatus: async () => {
      throw new SessionCreationNotFoundError("No session creation in progress");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/creation`, {
      headers: authHeaders(),
    });
    assert.equal(res.status, 404);
  });
});

test("GET /api/projects/:id/sessions/:name/creation returns 404 for an unknown project", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/unknown-id/sessions/feature-x/creation`, {
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

// --- Changes + diff ---

test("GET /api/projects/:id/sessions/:name/changes without a token returns 401", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/changes`);
    assert.equal(res.status, 401);
  });
});

test("GET /api/projects/:id/sessions/:name/changes returns the grouped changes", async () => {
  const grouped: GroupedChanges = {
    // No oldPath here -- JSON.stringify drops `undefined` properties, so the
    // response body won't have the key at all once it round-trips.
    staged: [{ path: "a.txt", status: "added", staged: true }],
    unstaged: [],
    untracked: [],
  };
  const deps = makeDeps({ getProjectSessionChanges: async () => grouped });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/changes`, {
      headers: authHeaders(),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), grouped);
  });
});

test("GET /api/projects/:id/sessions/:name/changes returns 404 for an unknown project", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/unknown-id/sessions/feature-x/changes`, {
      headers: authHeaders(),
    });
    assert.equal(res.status, 404);
  });
});

test("GET /api/projects/:id/sessions/:name/changes returns 404 when the worktree is gone (WorktreeNotFoundError)", async () => {
  const deps = makeDeps({
    getProjectSessionChanges: async () => {
      throw new WorktreeNotFoundError("gone");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/changes`, {
      headers: authHeaders(),
    });
    assert.equal(res.status, 404);
  });
});

test("GET /api/projects/:id/sessions/:name/diff without a token returns 401", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/diff?path=a.txt&mode=unstaged`,
    );
    assert.equal(res.status, 401);
  });
});

test("GET /api/projects/:id/sessions/:name/diff returns the diff for the requested file", async () => {
  const calls: Array<{ slug: string; path: string; mode: string }> = [];
  const deps = makeDeps({
    getProjectSessionDiff: async (_project: Project, slug: string, path: string, mode: string) => {
      calls.push({ slug, path, mode });
      return { diff: "+hello\n", isUntracked: false, isBinary: false };
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/diff?path=src%2Findex.ts&mode=staged`,
      { headers: authHeaders() },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { diff: "+hello\n", isUntracked: false, isBinary: false });
    assert.deepEqual(calls, [{ slug: "feature-x", path: "src/index.ts", mode: "staged" }]);
  });
});

test("GET /api/projects/:id/sessions/:name/diff returns 400 when path is missing", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/diff?mode=unstaged`,
      { headers: authHeaders() },
    );
    assert.equal(res.status, 400);
  });
});

test("GET /api/projects/:id/sessions/:name/diff returns 400 when mode is invalid", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/diff?path=a.txt&mode=bogus`,
      { headers: authHeaders() },
    );
    assert.equal(res.status, 400);
  });
});

test("GET /api/projects/:id/sessions/:name/diff returns 400 for a path-traversal attempt (GitStatusError)", async () => {
  const deps = makeDeps({
    getProjectSessionDiff: async () => {
      throw new GitStatusError("escapes the worktree");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/diff?path=..%2F..%2Fetc%2Fpasswd&mode=untracked`,
      { headers: authHeaders() },
    );
    assert.equal(res.status, 400);
  });
});

test("GET /api/projects/:id/sessions/:name/diff returns 404 for an unknown project", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/projects/unknown-id/sessions/feature-x/diff?path=a.txt&mode=unstaged`,
      { headers: authHeaders() },
    );
    assert.equal(res.status, 404);
  });
});

// --- Environment setup ---

test("GET /api/projects/:id/sessions/:name/env without a token returns 401", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/env`);
    assert.equal(res.status, 401);
  });
});

test("GET /api/projects/:id/sessions/:name/env returns the current status", async () => {
  const status: EnvStatus = { phase: "running", openUrl: "http://localhost:54321" };
  const deps = makeDeps({ getProjectSessionEnvStatus: async () => status });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/env`, {
      headers: authHeaders(),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), status);
  });
});

test("GET /api/projects/:id/sessions/:name/env passes the request's own Host header through, not a hardcoded one", async () => {
  // Regression test: previously the "Open" URL was always built from a
  // hardcoded "localhost", which is wrong whenever the browser is reaching
  // tmux-web via a LAN IP or a VPN IP instead. The Host header of the
  // incoming request is the one signal that tells us which address the
  // browser is CURRENTLY using, so it must be threaded through untouched.
  let capturedHost: string | undefined;
  const status: EnvStatus = { phase: "running", openUrl: "http://10.8.0.2:54321" };
  const deps = makeDeps({
    getProjectSessionEnvStatus: async (_project: Project, _slug: string, requestHost?: string) => {
      capturedHost = requestHost;
      return status;
    },
  });

  await withServer(deps, async (baseUrl) => {
    const { port } = new URL(baseUrl);
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: Number(port),
          path: `/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/env`,
          headers: authHeaders({ Host: "10.8.0.2:5309" }),
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve());
        },
      );
      req.on("error", reject);
      req.end();
    });
  });

  assert.equal(capturedHost, "10.8.0.2");
});

test("GET /api/projects/:id/sessions/:name/env returns 404 for an unknown project", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/unknown-id/sessions/feature-x/env`, {
      headers: authHeaders(),
    });
    assert.equal(res.status, 404);
  });
});

test("GET /api/projects/:id/sessions/:name/env returns 400 for a malformed env.json (EnvConfigError)", async () => {
  const deps = makeDeps({
    getProjectSessionEnvStatus: async () => {
      throw new EnvConfigError("Malformed env.json: Unexpected token");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/env`, {
      headers: authHeaders(),
    });
    assert.equal(res.status, 400);
  });
});

test("POST /api/projects/:id/sessions/:name/env without a token returns 401", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/env`, {
      method: "POST",
    });
    assert.equal(res.status, 401);
  });
});

test("POST /api/projects/:id/sessions/:name/env starts the environment and returns 202", async () => {
  const calls: Array<{ slug: string }> = [];
  const deps = makeDeps({
    startProjectSessionEnv: async (_project: Project, slug: string) => {
      calls.push({ slug });
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/env`, {
      method: "POST",
      headers: authHeaders(),
    });
    assert.equal(res.status, 202);
    assert.deepEqual(calls, [{ slug: "feature-x" }]);
  });
});

test("POST /api/projects/:id/sessions/:name/env returns 404 when the project hasn't opted in (EnvUnavailableError)", async () => {
  const deps = makeDeps({
    startProjectSessionEnv: async () => {
      throw new EnvUnavailableError("no .tmux-web-env");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/env`, {
      method: "POST",
      headers: authHeaders(),
    });
    assert.equal(res.status, 404);
  });
});

test("POST /api/projects/:id/sessions/:name/env returns 409 when already running (EnvAlreadyRunningError)", async () => {
  const deps = makeDeps({
    startProjectSessionEnv: async () => {
      throw new EnvAlreadyRunningError("already running");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/env`, {
      method: "POST",
      headers: authHeaders(),
    });
    assert.equal(res.status, 409);
  });
});

test("POST /api/projects/:id/sessions/:name/env returns 400 for a malformed env.json (EnvConfigError)", async () => {
  const deps = makeDeps({
    startProjectSessionEnv: async () => {
      throw new EnvConfigError("Malformed env.json: Unexpected token");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/env`, {
      method: "POST",
      headers: authHeaders(),
    });
    assert.equal(res.status, 400);
  });
});

test("POST /api/projects/:id/sessions/:name/env returns 404 for an unknown project", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/unknown-id/sessions/feature-x/env`, {
      method: "POST",
      headers: authHeaders(),
    });
    assert.equal(res.status, 404);
  });
});

test("DELETE /api/projects/:id/sessions/:name/env without a token returns 401", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/env`, {
      method: "DELETE",
    });
    assert.equal(res.status, 401);
  });
});

test("DELETE /api/projects/:id/sessions/:name/env stops the environment and returns 204", async () => {
  const calls: Array<{ slug: string }> = [];
  const deps = makeDeps({
    stopProjectSessionEnv: async (_project: Project, slug: string) => {
      calls.push({ slug });
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/env`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(res.status, 204);
    assert.deepEqual(calls, [{ slug: "feature-x" }]);
  });
});

test("DELETE /api/projects/:id/sessions/:name/env returns 409 when nothing is running (EnvNotRunningError)", async () => {
  const deps = makeDeps({
    stopProjectSessionEnv: async () => {
      throw new EnvNotRunningError("not running");
    },
  });
  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/${SAMPLE_PROJECT.id}/sessions/feature-x/env`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(res.status, 409);
  });
});

test("DELETE /api/projects/:id/sessions/:name/env returns 404 for an unknown project", async () => {
  await withServer(makeDeps(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/unknown-id/sessions/feature-x/env`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(res.status, 404);
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
