import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebShellStore } from "../stores/webShellStore";
import { WebSidebar } from "./WebSidebar";

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
    deleteSession: vi.fn().mockResolvedValue(undefined),
    isBranchMerged: vi.fn(),
    listTemplates: vi.fn().mockResolvedValue([]),
    createTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    getAccessLog: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

async function renderSidebar(overrides: Record<string, unknown> = {}) {
  const api = fakeApi(overrides);
  const store = createWebShellStore({ api });
  await store.loadProjects();
  const onSwitchServer = vi.fn();
  render(() => <WebSidebar store={store} api={api} serverHost="tmux.example.com" onSwitchServer={onSwitchServer} />);
  return { store, api, onSwitchServer };
}

describe("WebSidebar", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists projects and expands to load+show sessions on click", async () => {
    const { store, api } = await renderSidebar();

    fireEvent.click(screen.getByText("app-a"));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.listSessions).toHaveBeenCalledWith("p1");
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(store.state.selectedProjectId).toBe("p1");
  });

  it("selecting a session updates the store", async () => {
    const { store } = await renderSidebar();
    fireEvent.click(screen.getByText("app-a"));
    await Promise.resolve();
    await Promise.resolve();

    fireEvent.click(screen.getByText("a"));

    expect(store.state.selectedSessionName).toBe("a");
  });

  it("shows the new-project dialog trigger and new-session row once expanded", async () => {
    const { store } = await renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(store.state.newProjectDialog).not.toBeNull();

    fireEvent.click(screen.getByText("app-a"));
    await Promise.resolve();
    await Promise.resolve();
    fireEvent.click(screen.getByText("New session"));
    expect(store.state.newSessionDialog?.projectId).toBe("p1");
  });

  // The session row is `[dot] [label] [meta] [action]` with no growing sibling,
  // so its trash icon used to sit right after the "1w" window count while the
  // project row's -- which does have a `flex: 1` sibling -- sat at the right
  // edge. Both are now pinned by the same auto-margin rule.
  // Only DOM order is asserted here, not the resulting position: this suite
  // runs under jsdom, which never loads screens.css, so a computed
  // `margin-left` would read as empty no matter what the stylesheet says.
  // Whether the icon actually lands at the right edge is a real-layout question
  // and was verified in a browser instead (CLAUDE.md's live-verification rule).
  it("renders the trash action as the last child of both project and session rows", async () => {
    await renderSidebar();

    fireEvent.click(screen.getByText("app-a"));
    await Promise.resolve();
    await Promise.resolve();

    const rows = document.querySelectorAll(".tw-sidebar-row--project, .tw-sidebar-row--session");
    const withAction = Array.from(rows).filter((row) => row.querySelector(".tw-sidebar-row__end-action"));
    // both a project row and a session row, otherwise this asserts nothing
    expect(withAction.length).toBeGreaterThan(1);
    for (const row of withAction) {
      expect(row.querySelector(".tw-sidebar-row__end-action")).toBe(row.lastElementChild);
    }
  });

  // The trash action now opens a confirm instead of deleting on the spot.
  it("opens a delete confirm from the trash action without also selecting the project", async () => {
    const { store, api } = await renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Delete project app-a" }));
    await Promise.resolve();

    expect(api.deleteProject).not.toHaveBeenCalled();
    expect(store.state.pendingDelete).toMatchObject({ kind: "project", forced: false });
    expect(store.state.selectedProjectId).toBeNull();

    await store.confirmPendingDelete();
    expect(api.deleteProject).toHaveBeenCalledWith("p1", { force: false });
  });

  it("calls onSwitchServer from the footer and shows the server host", async () => {
    const { onSwitchServer } = await renderSidebar();

    expect(screen.getByText("tmux.example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Log out"));

    expect(onSwitchServer).toHaveBeenCalledOnce();
  });

  // The whole reason LogoutIcon lives in ui/ rather than being inlined twice:
  // the mobile copy was corrected while this one kept the old gear (which reads
  // as a sun at icon size), so one action wore two icons. Asserting on the
  // rendered path data is what actually catches a divergence -- a shared import
  // could still be swapped back to a local SVG without any test noticing.
  it("uses the same logout icon as the mobile project list", async () => {
    await renderSidebar();

    const row = screen.getByText("Log out").closest("button");
    const paths = Array.from(row?.querySelectorAll("svg path") ?? []).map((p) => p.getAttribute("d"));

    // the arrow-leaving-a-panel shape, not a circle ringed by spokes
    expect(paths).toHaveLength(2);
    expect(paths[1]).toContain("M7.8 9h7.2");
    expect(row?.querySelector("svg circle")).toBeNull();
  });

  it("collapses to an icon rail and can be expanded again", async () => {
    const { store } = await renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(store.state.sidebarCollapsed).toBe(true);
    expect(screen.queryByText("PROJECTS")).toBeNull();
    expect(screen.getByRole("button", { name: "app-a" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(store.state.sidebarCollapsed).toBe(false);
  });
});
