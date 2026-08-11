import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../api/errors";
import { createPushStore } from "../stores/pushStore";
import { createWebShellStore } from "../stores/webShellStore";
import { WebShellScreen } from "./WebShellScreen";

const PROJECT_A = { id: "p1", name: "app-a", repoPath: "/repos/a", createdAt: "2026-01-01T00:00:00Z" };
const SESSION_A = { name: "a", fullName: "p1__a", windows: 1, windowNames: [], attached: true, label: null, favorite: false };

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    listProjects: vi.fn().mockResolvedValue([PROJECT_A]),
    createProject: vi.fn(),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([SESSION_A]),
    createSession: vi.fn(),
    getSessionCreationStatus: vi.fn(),
    deleteSession: vi.fn(),
    isBranchMerged: vi.fn().mockResolvedValue(false),
    listTemplates: vi.fn().mockResolvedValue([]),
    createTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    getChanges: vi.fn().mockResolvedValue({ staged: [], unstaged: [], untracked: [], conflicted: [], repoState: "clean" }),
    getDiff: vi.fn(),
    stageFile: vi.fn(),
    unstageFile: vi.fn(),
    discardFile: vi.fn(),
    commitChanges: vi.fn(),
    getPasteBuffer: vi.fn().mockResolvedValue(""),
    getSessionResourceUsage: vi.fn().mockResolvedValue({ available: false, services: [] }),
    getAccessLog: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

async function renderShell(overrides: Record<string, unknown> = {}) {
  const api = fakeApi(overrides);
  const store = createWebShellStore({ api });
  await store.loadProjects();
  const onSwitchServer = vi.fn();
  // isBrowserPushSupported: false -- push toggle rendering/behavior is
  // covered by PushNotificationToggle.test.tsx and WebMainPane.test.tsx;
  // this suite only needs a real store instance to satisfy the prop.
  const pushStore = createPushStore({ api: api as never, isBrowserPushSupported: () => false });
  const { container } = render(() => (
    <WebShellScreen
      store={store}
      api={api as never}
      baseUrl="https://tmux.example.com"
      token="tok"
      serverHost="tmux.example.com"
      onSwitchServer={onSwitchServer}
      pushStore={pushStore}
    />
  ));
  return { store, api, onSwitchServer, container };
}

describe("WebShellScreen", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the sidebar and an empty main pane initially", async () => {
    await renderShell();

    expect(screen.getByText("app-a")).toBeInTheDocument();
    expect(screen.getByText("Select a session")).toBeInTheDocument();
  });

  it("opens the New Project sheet from the sidebar", async () => {
    const { store } = await renderShell();

    fireEvent.click(screen.getByRole("button", { name: "New project" }));

    expect(store.state.newProjectDialog).not.toBeNull();
    expect(screen.getByText("New Project")).toBeInTheDocument();
  });

  it("shows a two-tier confirm for deleting a session with an unmerged branch", async () => {
    const { store } = await renderShell({
      deleteSession: vi.fn().mockRejectedValue(new ConflictError("has changes")),
    });
    store.requestDeleteSession("p1", SESSION_A);
    expect(screen.getByText("Delete session")).toBeInTheDocument();
    // First confirm hits the 409 and escalates the dialog to its force variant.
    await store.confirmPendingDelete();

    fireEvent.click(screen.getByLabelText("Delete branch too"));
    await Promise.resolve();
    await Promise.resolve();

    expect(await screen.findByText(/This branch has unmerged commits\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Force delete" })).toBeInTheDocument();
  });

  it("shows a plain confirm for deleting a project", async () => {
    const { store } = await renderShell({ deleteProject: vi.fn().mockRejectedValue(new ConflictError("2 sessions")) });
    store.requestDeleteProject(PROJECT_A);

    // The first confirm is plain -- the server's conflict message only appears
    // after that confirm is taken.
    expect(screen.getByText("Delete project")).toBeInTheDocument();
    expect(screen.getByText(/Delete project "app-a"/)).toBeInTheDocument();

    await store.confirmPendingDelete();
    expect(await screen.findByText("2 sessions")).toBeInTheDocument();
  });

  // MARK: command palette (#18g)

  it("Ctrl+K opens the command palette and eagerly loads every project's sessions", async () => {
    const { api } = await renderShell();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByLabelText("Search projects and sessions")).toBeInTheDocument();
    expect(api.listSessions).toHaveBeenCalledWith("p1");
  });

  it("Cmd+K (metaKey) also opens the command palette", async () => {
    await renderShell();

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(screen.getByLabelText("Search projects and sessions")).toBeInTheDocument();
  });

  it("selecting a project from the palette selects it and closes the palette", async () => {
    const { store } = await renderShell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await Promise.resolve();

    fireEvent.click(screen.getByRole("option", { name: "app-a" }));

    expect(store.state.selectedProjectId).toBe("p1");
    expect(screen.queryByLabelText("Search projects and sessions")).toBeNull();
  });

  it("Escape closes the palette", async () => {
    await renderShell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByLabelText("Search projects and sessions");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByLabelText("Search projects and sessions")).toBeNull();
  });

  it("does not open the palette while another dialog (New Project sheet) is already open", async () => {
    await renderShell();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByText("New Project")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.queryByLabelText("Search projects and sessions")).toBeNull();
    expect(screen.getByText("New Project")).toBeInTheDocument();
  });

  it("does not open the palette when Ctrl+K originates inside the terminal (a real shell keystroke there)", async () => {
    const { container } = await renderShell();
    const fakeTerminalRoot = document.createElement("div");
    fakeTerminalRoot.className = "tw-web-main-pane__terminal";
    container.appendChild(fakeTerminalRoot);

    fireEvent.keyDown(fakeTerminalRoot, { key: "k", ctrlKey: true, bubbles: true });

    expect(screen.queryByLabelText("Search projects and sessions")).toBeNull();
  });

  it("does not open the palette when Ctrl+K originates inside the mobile terminal container either", async () => {
    const { container } = await renderShell();
    const fakeTerminalRoot = document.createElement("div");
    fakeTerminalRoot.className = "tw-terminal-screen__view";
    container.appendChild(fakeTerminalRoot);

    fireEvent.keyDown(fakeTerminalRoot, { key: "k", ctrlKey: true, bubbles: true });

    expect(screen.queryByLabelText("Search projects and sessions")).toBeNull();
  });
});
