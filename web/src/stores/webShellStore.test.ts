import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ServerError } from "../api/errors";
import { createWebShellStore } from "./webShellStore";

const PROJECT_A = { id: "p1", name: "app-a", repoPath: "/repos/a", createdAt: "2026-01-01T00:00:00Z" };
const PROJECT_B = { id: "p2", name: "app-b", repoPath: "/repos/b", createdAt: "2026-01-01T00:00:00Z" };
const SESSION_A = { name: "a", fullName: "p1__a", windows: 1, windowNames: [], attached: true, label: null, favorite: false };
const SESSION_B = { name: "b", fullName: "p2__b", windows: 1, windowNames: [], attached: false, label: null, favorite: false };

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    listProjects: vi.fn().mockResolvedValue([PROJECT_A]),
    createProject: vi.fn().mockResolvedValue(PROJECT_A),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([SESSION_A]),
    createSession: vi.fn(),
    getSessionCreationStatus: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    isBranchMerged: vi.fn().mockResolvedValue(true),
    listTemplates: vi.fn().mockResolvedValue([]),
    createTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    ...overrides,
  };
}

describe("createWebShellStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads projects", async () => {
    const store = createWebShellStore({ api: fakeApi() });

    await store.loadProjects();

    expect(store.state.projects).toEqual([PROJECT_A]);
  });

  it("toggleProject expands and lazily loads that project's sessions once", async () => {
    const api = fakeApi();
    const store = createWebShellStore({ api });
    await store.loadProjects();

    store.toggleProject("p1");
    await Promise.resolve();
    await Promise.resolve();

    expect(store.state.expandedProjectIds).toEqual(["p1"]);
    expect(api.listSessions).toHaveBeenCalledWith("p1");
    expect(store.state.sessionsByProjectId.p1).toEqual([SESSION_A]);

    store.toggleProject("p1");
    expect(store.state.expandedProjectIds).toEqual([]);
  });

  it("loadAllSessions loads every project's sessions without expanding them in the sidebar", async () => {
    const api = fakeApi({
      listProjects: vi.fn().mockResolvedValue([PROJECT_A, PROJECT_B]),
      listSessions: vi.fn().mockImplementation((projectId: string) =>
        Promise.resolve(projectId === "p1" ? [SESSION_A] : [SESSION_B]),
      ),
    });
    const store = createWebShellStore({ api });
    await store.loadProjects();

    store.loadAllSessions();
    await Promise.resolve();
    await Promise.resolve();

    expect(api.listSessions).toHaveBeenCalledWith("p1");
    expect(api.listSessions).toHaveBeenCalledWith("p2");
    expect(store.state.sessionsByProjectId).toEqual({ p1: [SESSION_A], p2: [SESSION_B] });
    expect(store.state.expandedProjectIds).toEqual([]);
  });

  // The sidebar shows "N session(s)" per project. That count used to be
  // populated only when a project was expanded, so an unexpanded project
  // rendered a confident "0 session(s)" for data that had never been fetched.
  it("loadProjects prefetches every project's sessions so the sidebar count is real", async () => {
    const api = fakeApi({ listProjects: vi.fn().mockResolvedValue([PROJECT_A, PROJECT_B]) });
    const store = createWebShellStore({ api });

    await store.loadProjects();
    await Promise.resolve();
    await Promise.resolve();

    expect(api.listSessions).toHaveBeenCalledWith("p1");
    expect(api.listSessions).toHaveBeenCalledWith("p2");
    expect(store.hasLoadedSessions("p1")).toBe(true);
    expect(store.hasLoadedSessions("p2")).toBe(true);
  });

  // Prefetching must not expand anything -- the count is filled in for rows
  // the user has not clicked, and they must stay collapsed.
  it("prefetching does not expand any project row", async () => {
    const api = fakeApi({ listProjects: vi.fn().mockResolvedValue([PROJECT_A, PROJECT_B]) });
    const store = createWebShellStore({ api });

    await store.loadProjects();
    await Promise.resolve();

    expect(store.state.expandedProjectIds).toEqual([]);
  });

  // The skip logic still matters: the command palette also calls this, and it
  // must not refetch what loadProjects already has.
  it("loadAllSessions skips projects whose sessions are already loaded", async () => {
    const api = fakeApi({ listProjects: vi.fn().mockResolvedValue([PROJECT_A, PROJECT_B]) });
    const store = createWebShellStore({ api });
    await store.loadProjects();
    await Promise.resolve();
    await Promise.resolve();
    api.listSessions.mockClear();

    store.loadAllSessions();
    await Promise.resolve();

    expect(api.listSessions).not.toHaveBeenCalled();
  });

  // Distinguishing "fetched, and there are none" from "not fetched yet" is the
  // whole point -- rendering both as 0 is what looked broken.
  it("hasLoadedSessions is false before a fetch and true after, even when empty", async () => {
    const api = fakeApi({
      listProjects: vi.fn().mockResolvedValue([PROJECT_A]),
      listSessions: vi.fn().mockResolvedValue([]),
    });
    const store = createWebShellStore({ api });

    expect(store.hasLoadedSessions("p1")).toBe(false);

    await store.loadProjects();
    await Promise.resolve();
    await Promise.resolve();

    expect(store.hasLoadedSessions("p1")).toBe(true);
  });

  it("selectProject selects and derives selectedProject/selectedSession", async () => {
    const store = createWebShellStore({ api: fakeApi() });
    await store.loadProjects();

    store.selectProject("p1");
    await Promise.resolve();
    await Promise.resolve();

    expect(store.selectedProject()).toEqual(PROJECT_A);
    expect(store.selectedSession()).toBeNull();

    store.selectSession("p1", "a");
    expect(store.selectedSession()).toEqual(SESSION_A);
  });

  it("toggleSidebarCollapsed flips the flag", () => {
    const store = createWebShellStore({ api: fakeApi() });

    store.toggleSidebarCollapsed();

    expect(store.state.sidebarCollapsed).toBe(true);
  });

  it("New Project dialog: opens, creates, and appends on success", async () => {
    const api = fakeApi();
    const store = createWebShellStore({ api });

    store.showNewProjectDialog();
    expect(store.state.newProjectDialog).toEqual({ isSaving: false, errorMessage: null });

    await store.createProject("app-a", "/repos/a");

    expect(api.createProject).toHaveBeenCalledWith({ name: "app-a", repoPath: "/repos/a" });
    expect(store.state.projects).toEqual([PROJECT_A]);
    expect(store.state.newProjectDialog).toBeNull();
  });

  it("New Session dialog: polls creation status until ready and appends into the right project", async () => {
    vi.useFakeTimers();
    const api = fakeApi({
      createSession: vi.fn().mockResolvedValue({ name: "b", fullName: "p1__b" }),
      getSessionCreationStatus: vi.fn().mockResolvedValueOnce({ phase: "creating", message: "Cloning…" }).mockResolvedValueOnce({
        phase: "ready",
        session: { name: "b", fullName: "p1__b", windows: 1, windowNames: [], attached: true, label: null, favorite: false },
      }),
    });
    const store = createWebShellStore({ api });
    store.showNewSessionDialog("p1");

    const pending = store.createSession("b");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.newSessionDialog?.progressMessage).toBe("Cloning…");

    await vi.advanceTimersByTimeAsync(1000);
    await pending;

    expect(store.state.newSessionDialog).toBeNull();
    expect(store.state.sessionsByProjectId.p1?.some((s) => s.name === "b")).toBe(true);
  });

  it("createSession passes an optional startupCommand through to the API", async () => {
    const api = fakeApi({
      createSession: vi.fn().mockResolvedValue({ name: "b", fullName: "p1__b" }),
      getSessionCreationStatus: vi.fn().mockResolvedValue({
        phase: "ready",
        session: { name: "b", fullName: "p1__b", windows: 1, windowNames: [], attached: true, label: null, favorite: false },
      }),
    });
    const store = createWebShellStore({ api });
    store.showNewSessionDialog("p1");

    await store.createSession("b", "npm run dev");

    expect(api.createSession).toHaveBeenCalledWith("p1", { name: "b", startupCommand: "npm run dev" });
  });

  const TEMPLATE_A = { id: "t1", projectId: "p1", name: "dev", startupCommand: "npm run dev", createdAt: "2026-01-01T00:00:00Z" };

  it("showNewSessionDialog also loads that project's templates into the dialog state", async () => {
    const api = fakeApi({ listTemplates: vi.fn().mockResolvedValue([TEMPLATE_A]) });
    const store = createWebShellStore({ api });

    store.showNewSessionDialog("p1");
    await vi.waitFor(() => expect(store.state.newSessionDialog?.templates).toEqual([TEMPLATE_A]));

    expect(api.listTemplates).toHaveBeenCalledWith("p1");
  });

  it("a failed template load leaves the dialog open with an empty template list (never blocks session creation)", async () => {
    const api = fakeApi({ listTemplates: vi.fn().mockRejectedValue(new Error("boom")) });
    const store = createWebShellStore({ api });

    store.showNewSessionDialog("p1");
    await Promise.resolve();
    await Promise.resolve();

    expect(store.state.newSessionDialog).not.toBeNull();
    expect(store.state.newSessionDialog?.templates).toEqual([]);
  });

  it("saveAsTemplate appends into the dialog's template list on success, sets its errorMessage on failure", async () => {
    const api = fakeApi({ createTemplate: vi.fn().mockResolvedValue(TEMPLATE_A) });
    const store = createWebShellStore({ api });
    store.showNewSessionDialog("p1");

    await store.saveAsTemplate("dev", "npm run dev");

    expect(api.createTemplate).toHaveBeenCalledWith("p1", { name: "dev", startupCommand: "npm run dev" });
    expect(store.state.newSessionDialog?.templates).toEqual([TEMPLATE_A]);

    const failingApi = fakeApi({ createTemplate: vi.fn().mockRejectedValue(new Error("boom")) });
    const failingStore = createWebShellStore({ api: failingApi });
    failingStore.showNewSessionDialog("p1");
    await failingStore.saveAsTemplate("dev");
    expect(failingStore.state.newSessionDialog?.errorMessage).toBe("boom");
  });

  it("deleteTemplate removes it from the dialog's template list", async () => {
    const api = fakeApi({ listTemplates: vi.fn().mockResolvedValue([TEMPLATE_A]), deleteTemplate: vi.fn().mockResolvedValue(undefined) });
    const store = createWebShellStore({ api });
    store.showNewSessionDialog("p1");
    await vi.waitFor(() => expect(store.state.newSessionDialog?.templates).toEqual([TEMPLATE_A]));

    await store.deleteTemplate("t1");

    expect(api.deleteTemplate).toHaveBeenCalledWith("p1", "t1");
    expect(store.state.newSessionDialog?.templates).toEqual([]);
  });

  it("saveAsTemplate/deleteTemplate are no-ops when no session dialog is open", async () => {
    const api = fakeApi();
    const store = createWebShellStore({ api });

    await store.saveAsTemplate("dev");
    await store.deleteTemplate("t1");

    expect(api.createTemplate).not.toHaveBeenCalled();
    expect(api.deleteTemplate).not.toHaveBeenCalled();
  });

  // Deleting used to happen on the click itself, with a prompt only if the
  // server returned 409 -- so a project with no live sessions was destroyed by
  // one click of a trash icon, unconfirmed.
  it("asks for confirmation before deleting a project, and only deletes once confirmed", async () => {
    const api = fakeApi();
    const store = createWebShellStore({ api });
    await store.loadProjects();

    store.requestDeleteProject(PROJECT_A);
    expect(api.deleteProject).not.toHaveBeenCalled();
    expect(store.state.pendingDelete).toMatchObject({ kind: "project", project: PROJECT_A, forced: false });
    expect(store.state.projects).toEqual([PROJECT_A]);

    await store.confirmPendingDelete();
    expect(api.deleteProject).toHaveBeenCalledWith("p1", { force: false });
    expect(store.state.projects).toEqual([]);
    expect(store.state.pendingDelete).toBeNull();
  });

  it("cancelling the confirm deletes nothing", async () => {
    const api = fakeApi();
    const store = createWebShellStore({ api });
    await store.loadProjects();

    store.requestDeleteProject(PROJECT_A);
    store.cancelPendingDelete();

    expect(api.deleteProject).not.toHaveBeenCalled();
    expect(store.state.projects).toEqual([PROJECT_A]);
    expect(store.state.pendingDelete).toBeNull();
  });

  // A 409 is a second, escalated question rather than an error, so the same
  // dialog stays open and swaps to its force variant.
  it("escalates the open dialog to force when the server reports a conflict", async () => {
    const store = createWebShellStore({
      api: fakeApi({ deleteProject: vi.fn().mockRejectedValue(new ConflictError("2 sessions active", 2)) }),
    });
    await store.loadProjects();

    store.requestDeleteProject(PROJECT_A);
    await store.confirmPendingDelete();

    expect(store.state.pendingDelete).toMatchObject({ kind: "project", forced: true, message: "2 sessions active" });
    expect(store.state.projects).toEqual([PROJECT_A]);
  });

  it("session delete-branch flow: checks merge status once and requires a second confirm when unmerged", async () => {
    const api = fakeApi({
      deleteSession: vi.fn().mockRejectedValueOnce(new ConflictError("has changes")).mockResolvedValueOnce(undefined),
      isBranchMerged: vi.fn().mockResolvedValue(false),
    });
    const store = createWebShellStore({ api });
    await store.loadProjects();
    store.selectProject("p1");
    store.requestDeleteSession("p1", SESSION_A);
    // first confirm: the server rejects with 409, escalating to force
    await store.confirmPendingDelete();

    await store.setDeleteBranchOnSessionDelete(true);
    expect(api.isBranchMerged).toHaveBeenCalledWith("p1", "a");
    expect(store.state.pendingDelete).toMatchObject({ branchMergeChecked: true, branchMerged: false, deleteBranch: true });

    // First confirm only flips unmergedConfirmed -- doesn't delete yet (the
    // one call so far is requestDeleteSession's own initial non-force
    // attempt above, not a new call from this confirm).
    await store.confirmPendingDelete();
    expect(api.deleteSession).toHaveBeenCalledTimes(1);
    expect(store.state.pendingDelete).toMatchObject({ unmergedConfirmed: true });

    // Second confirm actually deletes.
    await store.confirmPendingDelete();
    expect(api.deleteSession).toHaveBeenLastCalledWith("p1", "a", { force: true, deleteBranch: true });
    expect(store.state.pendingDelete).toBeNull();
  });

  it("clears the current selection if the deleted session was selected", async () => {
    const api = fakeApi({ deleteSession: vi.fn().mockRejectedValueOnce(new ConflictError("x")).mockResolvedValueOnce(undefined) });
    const store = createWebShellStore({ api });
    await store.loadProjects();
    store.selectSession("p1", "a");
    store.requestDeleteSession("p1", SESSION_A);

    await store.confirmPendingDelete(); // 409 -> escalates to force
    await store.confirmPendingDelete(); // force delete succeeds

    expect(store.state.selectedSessionName).toBeNull();
  });

  it("cancelPendingDelete clears the prompt without deleting", async () => {
    const api = fakeApi({ deleteSession: vi.fn().mockRejectedValue(new ConflictError("x")) });
    const store = createWebShellStore({ api });
    await store.requestDeleteSession("p1", SESSION_A);

    store.cancelPendingDelete();

    expect(store.state.pendingDelete).toBeNull();
  });

  it("hasOpenDialog reflects any of the three dialog states", () => {
    const store = createWebShellStore({ api: fakeApi() });
    expect(store.hasOpenDialog()).toBe(false);

    store.showNewProjectDialog();
    expect(store.hasOpenDialog()).toBe(true);
  });

  it("dismissError clears the top-level error", async () => {
    const store = createWebShellStore({ api: fakeApi({ listProjects: vi.fn().mockRejectedValue(new ServerError(500, "boom")) }) });
    await store.loadProjects();

    store.dismissError();

    expect(store.state.errorMessage).toBeNull();
  });
});
