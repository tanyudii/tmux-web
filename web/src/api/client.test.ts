import { beforeEach, describe, expect, test, vi } from "vitest";
import { createApiClient } from "./client";
import { BadRequestError, ConflictError, NotFoundError, TransportError, UnauthorizedError } from "./errors";

// Ports kmp/.../KtorRepositoriesTest.kt 1:1 in spirit: same fixtures, same
// status-code-to-error mapping assertions, but against fetch() instead of
// Ktor's MockEngine.
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

describe("createApiClient", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  function client() {
    return createApiClient({
      baseUrl: "http://vpn-host:5309",
      token: "test-token-0123456789",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
  }

  // MARK: Projects

  test("listProjects sends bearer token and decodes response", async () => {
    // Arrange
    fetchImpl.mockResolvedValue(
      jsonResponse(200, {
        projects: [{ id: "p1", name: "Demo", repoPath: "/repo", createdAt: "2026-01-01T00:00:00.000Z" }],
      }),
    );

    // Act
    const projects = await client().listProjects();

    // Assert
    expect(projects).toEqual([{ id: "p1", name: "Demo", repoPath: "/repo", createdAt: "2026-01-01T00:00:00.000Z" }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://vpn-host:5309/api/projects");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer test-token-0123456789");
  });

  test("listProjects unauthorized throws UnauthorizedError", async () => {
    fetchImpl.mockResolvedValue(emptyResponse(401));

    await expect(client().listProjects()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test("createProject sends JSON body and returns the created project", async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(201, { id: "p1", name: "Demo", repoPath: "/repo", createdAt: "2026-01-01T00:00:00.000Z" }),
    );

    const project = await client().createProject({ name: "Demo", repoPath: "/repo" });

    expect(project.id).toBe("p1");
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Demo", repoPath: "/repo" });
    expect((init.headers as Headers).get("Content-Type")).toBe("application/json");
  });

  test("createProject bad request throws BadRequestError with server message", async () => {
    fetchImpl.mockResolvedValue(jsonResponse(400, { error: "Missing name or repoPath" }));

    const error: unknown = await client()
      .createProject({ name: "", repoPath: "" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as BadRequestError).serverMessage).toBe("Missing name or repoPath");
  });

  test("deleteProject conflict surfaces active session count", async () => {
    fetchImpl.mockResolvedValue(jsonResponse(409, { error: "Project has active sessions", sessionCount: 2 }));

    const error: unknown = await client()
      .deleteProject("p1")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).sessionCount).toBe(2);
  });

  test("deleteProject force=true appends the force query parameter", async () => {
    fetchImpl.mockResolvedValue(emptyResponse(204));

    await client().deleteProject("p1", { force: true });

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://vpn-host:5309/api/projects/p1?force=true");
  });

  test("deleteProject omits the force query parameter by default", async () => {
    fetchImpl.mockResolvedValue(emptyResponse(204));

    await client().deleteProject("p1");

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://vpn-host:5309/api/projects/p1");
  });

  // MARK: Sessions

  test("createSession posts to the project's sessions endpoint", async () => {
    fetchImpl.mockResolvedValue(jsonResponse(202, { name: "my-branch", fullName: "p1--my-branch" }));

    const pending = await client().createSession("p1", { name: "my-branch" });

    expect(pending).toEqual({ name: "my-branch", fullName: "p1--my-branch" });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://vpn-host:5309/api/projects/p1/sessions");
  });

  test("deleteSession sends both force and deleteBranch query parameters when set", async () => {
    fetchImpl.mockResolvedValue(emptyResponse(204));

    await client().deleteSession("p1", "my-branch", { force: true, deleteBranch: true });

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://vpn-host:5309/api/projects/p1/sessions/my-branch?force=true&deleteBranch=true");
  });

  test("deleteSession not found throws NotFoundError", async () => {
    fetchImpl.mockResolvedValue(jsonResponse(404, { error: "Project not found" }));

    await expect(client().deleteSession("missing", "my-branch")).rejects.toBeInstanceOf(NotFoundError);
  });

  test("isBranchMerged decodes the merged boolean", async () => {
    fetchImpl.mockResolvedValue(jsonResponse(200, { merged: true }));

    await expect(client().isBranchMerged("p1", "my-branch")).resolves.toBe(true);
  });

  test("setSessionMeta sends a PUT with the whole label/favorite record", async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(200, { projectId: "p1", sessionSlug: "my-branch", label: "prod", favorite: true }),
    );

    const meta = await client().setSessionMeta("p1", "my-branch", "prod", true);

    expect(meta.label).toBe("prod");
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ label: "prod", favorite: true });
  });

  // MARK: Env

  test("getEnvStatus decodes the phase enum", async () => {
    fetchImpl.mockResolvedValue(jsonResponse(200, { phase: "running" }));

    const status = await client().getEnvStatus("p1", "my-branch");

    expect(status.phase).toBe("running");
  });

  test("startEnv posts with no body and succeeds on 202", async () => {
    fetchImpl.mockResolvedValue(emptyResponse(202));

    await client().startEnv("p1", "my-branch");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(url).toBe("http://vpn-host:5309/api/projects/p1/sessions/my-branch/env");
  });

  // MARK: Push

  test("getPushPublicKey decodes the publicKey string", async () => {
    fetchImpl.mockResolvedValue(jsonResponse(200, { publicKey: "abc123" }));

    await expect(client().getPushPublicKey()).resolves.toBe("abc123");
  });

  test("subscribePush sends the endpoint and keys", async () => {
    fetchImpl.mockResolvedValue(emptyResponse(204));

    await client().subscribePush({ endpoint: "https://push.example/x", keys: { p256dh: "a", auth: "b" } });

    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      endpoint: "https://push.example/x",
      keys: { p256dh: "a", auth: "b" },
    });
  });

  // MARK: Access log

  test("getAccessLog decodes the entries array", async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(200, {
        entries: [{ timestamp: "2026-01-01T00:00:00.000Z", ip: "127.0.0.1", method: "GET", path: "/api/projects", outcome: "authorized" }],
      }),
    );

    const entries = await client().getAccessLog();

    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe("authorized");
  });

  // MARK: Shared apiFetch behavior

  test("a network failure maps to TransportError", async () => {
    fetchImpl.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(client().listProjects()).rejects.toBeInstanceOf(TransportError);
  });

  test("browseDirectory forwards the path query parameter when given", async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(200, { path: "/home", isGitRepo: false, entries: [], truncated: false }),
    );

    await client().browseDirectory("/home");

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://vpn-host:5309/api/browse?path=%2Fhome");
  });

  test("browseDirectory omits the path query parameter when undefined", async () => {
    fetchImpl.mockResolvedValue(jsonResponse(200, { path: "/", isGitRepo: false, entries: [], truncated: false }));

    await client().browseDirectory();

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://vpn-host:5309/api/browse");
  });
});
