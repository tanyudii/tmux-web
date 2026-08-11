import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../api/errors";
import { createProjectListStore } from "../stores/projectListStore";
import { ProjectListScreen } from "./ProjectListScreen";

const PROJECT_A = { id: "1", name: "app-a", repoPath: "/repos/a", createdAt: "2026-01-01T00:00:00Z" };

function renderScreen(overrides: Partial<Parameters<typeof createProjectListStore>[0]["api"]> = {}) {
  const api = {
    listProjects: vi.fn().mockResolvedValue([PROJECT_A]),
    createProject: vi.fn().mockResolvedValue(PROJECT_A),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    browseDirectory: vi.fn().mockResolvedValue({ path: "/", parentPath: null, isGitRepo: false, entries: [], truncated: false }),
    ...overrides,
  };
  const store = createProjectListStore({ api });
  const onOpenProject = vi.fn();
  const onSwitchServer = vi.fn();
  render(() => (
    <ProjectListScreen store={store} api={api} onOpenProject={onOpenProject} onSwitchServer={onSwitchServer} />
  ));
  return { store, api, onOpenProject, onSwitchServer };
}

describe("ProjectListScreen", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the empty state before any project is loaded", () => {
    renderScreen();

    expect(screen.getByText("No projects")).toBeInTheDocument();
  });

  it("lists loaded projects and opens one on click", async () => {
    const { store, onOpenProject } = renderScreen();
    await store.load();

    fireEvent.click(screen.getByRole("button", { name: /^app-a/ }));

    expect(onOpenProject).toHaveBeenCalledWith(PROJECT_A);
  });

  // Labelled "Log out" rather than "Switch server": the handler is
  // connectionSettingsStore.clear(), which erases the saved token, so logout is
  // what it actually does and what a user looking for it will search for.
  it("calls onSwitchServer from the nav bar's leading control", () => {
    const { onSwitchServer } = renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(onSwitchServer).toHaveBeenCalledOnce();
  });

  it("opens the New Project sheet and creates a project without navigating the row", async () => {
    const { store, api } = renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(screen.getByText("New Project")).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "app-a" } });
    fireEvent.click(screen.getByText("Add"));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.createProject).toHaveBeenCalledWith({ name: "app-a", repoPath: "" });
    expect(store.state.newProject).toBeNull();
  });

  it("deleting a project does not also trigger onOpenProject for that row", async () => {
    const { store, onOpenProject } = renderScreen();
    await store.load();

    fireEvent.click(screen.getByRole("button", { name: "Delete app-a" }));
    await Promise.resolve();

    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it("shows a force-delete confirmation on a 409 and force-deletes on confirm", async () => {
    const { store } = renderScreen({
      deleteProject: vi
        .fn()
        .mockRejectedValueOnce(new ConflictError("2 sessions still active", 2))
        .mockResolvedValueOnce(undefined),
    });
    await store.load();

    // The trash icon now opens a confirm rather than deleting; the 409 (and so
    // the force variant) only appears once that first confirm is taken.
    fireEvent.click(screen.getByRole("button", { name: "Delete app-a" }));
    expect(await screen.findByText(/Delete project "app-a"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await Promise.resolve();
    expect(await screen.findByText("2 sessions still active")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Force delete" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(store.state.projects).toEqual([]);
    expect(screen.queryByText("2 sessions still active")).toBeNull();
  });
});
