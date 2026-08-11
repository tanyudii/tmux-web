import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ServerError } from "../api/errors";
import { createSessionListStore } from "./sessionListStore";

const SESSION_A = { name: "a", fullName: "proj__a", windows: 1, windowNames: [], attached: true, label: null, favorite: false };
const SESSION_B = { name: "b", fullName: "proj__b", windows: 2, windowNames: [], attached: false, label: null, favorite: false };

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    listSessions: vi.fn().mockResolvedValue([SESSION_A, SESSION_B]),
    createSession: vi.fn(),
    getSessionCreationStatus: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    setSessionMeta: vi.fn(),
    listTemplates: vi.fn().mockResolvedValue([]),
    createTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    ...overrides,
  };
}

describe("createSessionListStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads sessions from the given project", async () => {
    const api = fakeApi();
    const store = createSessionListStore({ projectId: "proj", api });

    await store.load();

    expect(api.listSessions).toHaveBeenCalledWith("proj");
    expect(store.state.sessions).toEqual([SESSION_A, SESSION_B]);
  });

  it("filteredSessions delegates to the existing domain/sessionFilter logic", async () => {
    const store = createSessionListStore({ projectId: "proj", api: fakeApi() });
    await store.load();

    store.setStatusFilter("active");

    expect(store.filteredSessions()).toEqual([SESSION_A]);
  });

  it("filters by branch query case-insensitively", async () => {
    const store = createSessionListStore({ projectId: "proj", api: fakeApi() });
    await store.load();

    store.setBranchQuery("B");

    expect(store.filteredSessions()).toEqual([SESSION_B]);
  });

  it("deletes a session on success and opens a force-delete prompt on conflict", async () => {
    const api = fakeApi({
      deleteSession: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new ConflictError("branch has unmerged commits")),
    });
    const store = createSessionListStore({ projectId: "proj", api });
    await store.load();

    store.requestDeleteSession(SESSION_A);
    await store.confirmDelete();
    expect(store.state.sessions).toEqual([SESSION_B]);

    store.requestDeleteSession(SESSION_B);
    await store.confirmDelete();
    expect(store.state.pendingDelete).toEqual({ session: SESSION_B, forced: true, message: "branch has unmerged commits" });

    await store.confirmForceDelete();
    expect(store.state.sessions).toEqual([]);
    expect(store.state.pendingDelete).toBeNull();
  });

  it("updates label/favorite in place from setSessionMeta's response", async () => {
    const api = fakeApi({
      setSessionMeta: vi.fn().mockResolvedValue({ projectId: "proj", sessionSlug: "a", label: "backend", favorite: true }),
    });
    const store = createSessionListStore({ projectId: "proj", api });
    await store.load();

    await store.setSessionMeta(SESSION_A, "backend", true);

    expect(store.state.sessions.find((s) => s.name === "a")).toMatchObject({ label: "backend", favorite: true });
  });

  it("polls session creation status until ready, appending the finished session", async () => {
    vi.useFakeTimers();
    const api = fakeApi({
      createSession: vi.fn().mockResolvedValue({ name: "c", fullName: "proj__c" }),
      getSessionCreationStatus: vi
        .fn()
        .mockResolvedValueOnce({ phase: "creating", message: "Cloning…" })
        .mockResolvedValueOnce({
          phase: "ready",
          session: { name: "c", fullName: "proj__c", windows: 1, windowNames: [], attached: true, label: null, favorite: false },
        }),
    });
    const store = createSessionListStore({ projectId: "proj", api });

    const pending = store.createSession("c");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.sessionCreation?.isSaving).toBe(true);
    expect(store.state.sessionCreation?.progressMessage).toBe("Cloning…");

    await vi.advanceTimersByTimeAsync(1000);
    await pending;

    expect(store.state.sessionCreation).toBeNull();
    expect(store.state.sessions.some((s) => s.name === "c")).toBe(true);
  });

  it("stops polling and surfaces the server's message when creation status reports error", async () => {
    vi.useFakeTimers();
    const api = fakeApi({
      createSession: vi.fn().mockResolvedValue({ name: "c", fullName: "proj__c" }),
      getSessionCreationStatus: vi.fn().mockResolvedValue({ phase: "error", message: "clone failed" }),
    });
    const store = createSessionListStore({ projectId: "proj", api });

    await store.createSession("c");

    expect(store.state.sessionCreation).toEqual({ isSaving: false, progressMessage: null, errorMessage: "clone failed" });
  });

  it("cancelSessionCreation stops a still-in-flight poll from touching state again", async () => {
    vi.useFakeTimers();
    const api = fakeApi({
      createSession: vi.fn().mockResolvedValue({ name: "c", fullName: "proj__c" }),
      getSessionCreationStatus: vi.fn().mockResolvedValue({ phase: "creating", message: "still going" }),
    });
    const store = createSessionListStore({ projectId: "proj", api });

    const pending = store.createSession("c");
    await vi.advanceTimersByTimeAsync(0);
    store.cancelSessionCreation();
    expect(store.state.sessionCreation).toBeNull();

    await vi.advanceTimersByTimeAsync(5000);
    await pending;

    expect(store.state.sessionCreation).toBeNull();
  });

  it("selection mode: toggling tracks selected names and clears on mode exit", () => {
    const store = createSessionListStore({ projectId: "proj", api: fakeApi() });

    store.toggleSelectionMode();
    store.toggleSessionSelected("a");
    store.toggleSessionSelected("b");
    store.toggleSessionSelected("a");
    expect(store.state.selectedNames).toEqual(["b"]);

    store.toggleSelectionMode();
    expect(store.state.isSelectionMode).toBe(false);
    expect(store.state.selectedNames).toEqual([]);
  });

  it("bulk delete: deletes all selected, collects 409s into a force-delete follow-up prompt", async () => {
    const api = fakeApi({
      deleteSession: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new ConflictError("unmerged")),
    });
    const store = createSessionListStore({ projectId: "proj", api });
    await store.load();
    store.toggleSelectionMode();
    store.toggleSessionSelected("a");
    store.toggleSessionSelected("b");

    store.requestBulkDelete();
    expect(store.state.pendingBulkDelete).toEqual({ names: ["a", "b"] });

    await store.confirmBulkDelete();

    expect(store.state.pendingBulkDelete).toBeNull();
    expect(store.state.isSelectionMode).toBe(false);
    expect(store.state.sessions).toEqual([SESSION_B]);
    expect(store.state.pendingBulkForceDelete).toEqual({ sessions: [SESSION_B] });
  });

  it("bulk force-delete resolves the follow-up prompt", async () => {
    const api = fakeApi({ deleteSession: vi.fn().mockResolvedValue(undefined) });
    const store = createSessionListStore({ projectId: "proj", api });
    await store.load();
    // Simulate having already gone through confirmBulkDelete's conflict path.
    store.toggleSelectionMode();
    store.toggleSessionSelected("b");
    store.requestBulkDelete();
    await store.confirmBulkDelete();

    const forceApi = fakeApi({
      deleteSession: vi
        .fn()
        .mockRejectedValueOnce(new ConflictError("unmerged"))
        .mockResolvedValueOnce(undefined),
    });
    const store2 = createSessionListStore({ projectId: "proj", api: forceApi });
    await store2.load();
    store2.toggleSelectionMode();
    store2.toggleSessionSelected("b");
    store2.requestBulkDelete();
    await store2.confirmBulkDelete();
    expect(store2.state.pendingBulkForceDelete).toEqual({ sessions: [SESSION_B] });

    await store2.confirmBulkForceDelete();

    expect(store2.state.pendingBulkForceDelete).toBeNull();
    expect(store2.state.sessions.some((s) => s.name === "b")).toBe(false);
  });

  it("requestBulkDelete is a no-op with nothing selected", () => {
    const store = createSessionListStore({ projectId: "proj", api: fakeApi() });

    store.requestBulkDelete();

    expect(store.state.pendingBulkDelete).toBeNull();
  });

  it("dismissError clears the top-level error", async () => {
    const store = createSessionListStore({
      projectId: "proj",
      api: fakeApi({ listSessions: vi.fn().mockRejectedValue(new ServerError(500, "boom")) }),
    });
    await store.load();

    store.dismissError();

    expect(store.state.errorMessage).toBeNull();
  });

  it("createSession passes an optional startupCommand through to the API", async () => {
    const api = fakeApi({
      createSession: vi.fn().mockResolvedValue({ name: "c", fullName: "proj__c" }),
      getSessionCreationStatus: vi.fn().mockResolvedValue({
        phase: "ready",
        session: { name: "c", fullName: "proj__c", windows: 1, windowNames: [], attached: true, label: null, favorite: false },
      }),
    });
    const store = createSessionListStore({ projectId: "proj", api });

    await store.createSession("c", "npm run dev");

    expect(api.createSession).toHaveBeenCalledWith("proj", { name: "c", startupCommand: "npm run dev" });
  });

  const TEMPLATE_A = { id: "t1", projectId: "proj", name: "dev", startupCommand: "npm run dev", createdAt: "2026-01-01T00:00:00Z" };

  it("loadTemplates populates state.templates and silently ignores failure", async () => {
    const api = fakeApi({ listTemplates: vi.fn().mockResolvedValue([TEMPLATE_A]) });
    const store = createSessionListStore({ projectId: "proj", api });

    await store.loadTemplates();

    expect(api.listTemplates).toHaveBeenCalledWith("proj");
    expect(store.state.templates).toEqual([TEMPLATE_A]);

    const failingApi = fakeApi({ listTemplates: vi.fn().mockRejectedValue(new Error("boom")) });
    const failingStore = createSessionListStore({ projectId: "proj", api: failingApi });
    await expect(failingStore.loadTemplates()).resolves.toBeUndefined();
    expect(failingStore.state.templates).toEqual([]);
  });

  it("saveAsTemplate appends the created template on success, sets errorMessage on failure", async () => {
    const api = fakeApi({ createTemplate: vi.fn().mockResolvedValue(TEMPLATE_A) });
    const store = createSessionListStore({ projectId: "proj", api });

    await store.saveAsTemplate("dev", "npm run dev");

    expect(api.createTemplate).toHaveBeenCalledWith("proj", { name: "dev", startupCommand: "npm run dev" });
    expect(store.state.templates).toEqual([TEMPLATE_A]);

    const failingApi = fakeApi({ createTemplate: vi.fn().mockRejectedValue(new Error("boom")) });
    const failingStore = createSessionListStore({ projectId: "proj", api: failingApi });
    await failingStore.saveAsTemplate("dev");
    expect(failingStore.state.errorMessage).toBe("boom");
  });

  it("deleteTemplate removes the template from state on success", async () => {
    const api = fakeApi({
      listTemplates: vi.fn().mockResolvedValue([TEMPLATE_A]),
      deleteTemplate: vi.fn().mockResolvedValue(undefined),
    });
    const store = createSessionListStore({ projectId: "proj", api });
    await store.loadTemplates();

    await store.deleteTemplate("t1");

    expect(api.deleteTemplate).toHaveBeenCalledWith("proj", "t1");
    expect(store.state.templates).toEqual([]);
  });
});
