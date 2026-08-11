import { describe, expect, it, vi } from "vitest";
import { ConflictError, ServerError } from "../api/errors";
import { createProjectListStore } from "./projectListStore";

const PROJECT_A = { id: "1", name: "app-a", repoPath: "/repos/a", createdAt: "2026-01-01T00:00:00Z" };
const PROJECT_B = { id: "2", name: "app-b", repoPath: "/repos/b", createdAt: "2026-01-02T00:00:00Z" };

function fakeApi(overrides: Partial<Parameters<typeof createProjectListStore>[0]["api"]> = {}) {
  return {
    listProjects: vi.fn().mockResolvedValue([PROJECT_A, PROJECT_B]),
    createProject: vi.fn().mockResolvedValue(PROJECT_A),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("createProjectListStore", () => {
  it("loads projects and reports isLoading around the request", async () => {
    const api = fakeApi();
    const store = createProjectListStore({ api });

    const pending = store.load();
    expect(store.state.isLoading).toBe(true);
    await pending;

    expect(store.state.projects).toEqual([PROJECT_A, PROJECT_B]);
    expect(store.state.isLoading).toBe(false);
  });

  it("surfaces a UI error message when load fails", async () => {
    const api = fakeApi({ listProjects: vi.fn().mockRejectedValue(new ServerError(500, "boom")) });
    const store = createProjectListStore({ api });

    await store.load();

    expect(store.state.errorMessage).toBe("boom");
    expect(store.state.isLoading).toBe(false);
  });

  it("opens and cancels the New Project sheet", () => {
    const store = createProjectListStore({ api: fakeApi() });

    store.showNewProjectSheet();
    expect(store.state.newProject).toEqual({ isSaving: false, errorMessage: null });

    store.cancelNewProject();
    expect(store.state.newProject).toBeNull();
  });

  it("creates a project, appends it, and closes the sheet on success", async () => {
    const api = fakeApi({ createProject: vi.fn().mockResolvedValue(PROJECT_A) });
    const store = createProjectListStore({ api });
    store.showNewProjectSheet();

    await store.createProject("app-a", "/repos/a");

    expect(api.createProject).toHaveBeenCalledWith({ name: "app-a", repoPath: "/repos/a" });
    expect(store.state.projects).toEqual([PROJECT_A]);
    expect(store.state.newProject).toBeNull();
  });

  it("keeps the sheet open with an error message when creation fails", async () => {
    const api = fakeApi({ createProject: vi.fn().mockRejectedValue(new ServerError(500, "name taken")) });
    const store = createProjectListStore({ api });
    store.showNewProjectSheet();

    await store.createProject("dup", "/repos/dup");

    expect(store.state.newProject).toEqual({ isSaving: false, errorMessage: "name taken" });
    expect(store.state.projects).toEqual([]);
  });

  it("removes the project from state on a successful non-force delete", async () => {
    const api = fakeApi();
    const store = createProjectListStore({ api });
    await store.load();

    store.requestDeleteProject(PROJECT_A);
    await store.confirmDelete();

    expect(api.deleteProject).toHaveBeenCalledWith("1", { force: false });
    expect(store.state.projects).toEqual([PROJECT_B]);
  });

  it("opens a force-delete confirmation on a 409 conflict instead of removing the project", async () => {
    const api = fakeApi({
      deleteProject: vi.fn().mockRejectedValue(new ConflictError("2 sessions still active", 2)),
    });
    const store = createProjectListStore({ api });
    await store.load();

    store.requestDeleteProject(PROJECT_A);
    await store.confirmDelete();

    expect(store.state.projects).toEqual([PROJECT_A, PROJECT_B]);
    expect(store.state.pendingDelete).toEqual({ project: PROJECT_A, forced: true, message: "2 sessions still active" });
  });

  it("force-deletes and clears the prompt on confirmForceDelete", async () => {
    const api = fakeApi({
      deleteProject: vi
        .fn()
        .mockRejectedValueOnce(new ConflictError("2 sessions still active", 2))
        .mockResolvedValueOnce(undefined),
    });
    const store = createProjectListStore({ api });
    await store.load();
    store.requestDeleteProject(PROJECT_A);
    await store.confirmDelete();

    await store.confirmForceDelete();

    expect(api.deleteProject).toHaveBeenLastCalledWith("1", { force: true });
    expect(store.state.projects).toEqual([PROJECT_B]);
    expect(store.state.pendingDelete).toBeNull();
  });

  it("cancelDelete dismisses the prompt without deleting", async () => {
    const api = fakeApi({
      deleteProject: vi.fn().mockRejectedValue(new ConflictError("2 sessions still active", 2)),
    });
    const store = createProjectListStore({ api });
    await store.load();
    store.requestDeleteProject(PROJECT_A);
    await store.confirmDelete();

    store.cancelDelete();

    expect(store.state.pendingDelete).toBeNull();
    expect(store.state.projects).toEqual([PROJECT_A, PROJECT_B]);
  });

  it("dismissError clears the top-level error message", async () => {
    const api = fakeApi({ listProjects: vi.fn().mockRejectedValue(new ServerError(500, "boom")) });
    const store = createProjectListStore({ api });
    await store.load();

    store.dismissError();

    expect(store.state.errorMessage).toBeNull();
  });
});
