import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import type { Project, ProjectSession } from "../api/types";

const PROJECT_A: Project = { id: "p1", name: "demo-app", repoPath: "/repo", createdAt: "2024-01-01T00:00:00Z" };
const PROJECT_B: Project = { id: "p2", name: "other-app", repoPath: "/repo2", createdAt: "2024-01-01T00:00:00Z" };
const SESSION_MAIN: ProjectSession = { name: "main", fullName: "p1__main", windows: 1, windowNames: [], attached: false, label: null, favorite: false };

describe("CommandPalette", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders every project and session, projects first", () => {
    render(() => (
      <CommandPalette
        projects={[PROJECT_A, PROJECT_B]}
        sessionsByProjectId={{ p1: [SESSION_MAIN] }}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />
    ));

    const rows = screen.getAllByRole("option");
    expect(rows).toHaveLength(3);
    // "demo-app" appears twice: the project row's own label, and the
    // session row's sublabel.
    expect(screen.getAllByText("demo-app")).toHaveLength(2);
    expect(screen.getByText("other-app")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("filters as the user types, matching sessions by their project's sublabel too", () => {
    render(() => (
      <CommandPalette
        projects={[PROJECT_A, PROJECT_B]}
        sessionsByProjectId={{ p1: [SESSION_MAIN] }}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />
    ));

    fireEvent.input(screen.getByLabelText("Search projects and sessions"), { target: { value: "demo" } });

    // "demo-app" appears twice: once as the project row's own label, once
    // as the session row's sublabel -- both survive the filter.
    expect(screen.getAllByText("demo-app")).toHaveLength(2);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.queryByText("other-app")).toBeNull();
  });

  it("shows 'No matches' when the query matches nothing", () => {
    render(() => (
      <CommandPalette projects={[PROJECT_A]} sessionsByProjectId={{}} onSelect={vi.fn()} onDismiss={vi.fn()} />
    ));

    fireEvent.input(screen.getByLabelText("Search projects and sessions"), { target: { value: "zzz-nope" } });

    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("clicking a row calls onSelect with that item", () => {
    const onSelect = vi.fn();
    render(() => (
      <CommandPalette projects={[PROJECT_A]} sessionsByProjectId={{}} onSelect={onSelect} onDismiss={vi.fn()} />
    ));

    fireEvent.click(screen.getByText("demo-app"));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "project", projectId: "p1" }));
  });

  it("ArrowDown/ArrowUp move the selection and Enter selects the highlighted row", () => {
    const onSelect = vi.fn();
    render(() => (
      <CommandPalette
        projects={[PROJECT_A, PROJECT_B]}
        sessionsByProjectId={{}}
        onSelect={onSelect}
        onDismiss={vi.fn()}
      />
    ));
    const input = screen.getByLabelText("Search projects and sessions");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "project", projectId: "p2" }));
  });

  it("ArrowUp from the first row wraps to the last row", () => {
    const onSelect = vi.fn();
    render(() => (
      <CommandPalette
        projects={[PROJECT_A, PROJECT_B]}
        sessionsByProjectId={{}}
        onSelect={onSelect}
        onDismiss={vi.fn()}
      />
    ));
    const input = screen.getByLabelText("Search projects and sessions");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "project", projectId: "p2" }));
  });

  it("Escape calls onDismiss", () => {
    const onDismiss = vi.fn();
    render(() => (
      <CommandPalette projects={[PROJECT_A]} sessionsByProjectId={{}} onSelect={vi.fn()} onDismiss={onDismiss} />
    ));

    fireEvent.keyDown(screen.getByLabelText("Search projects and sessions"), { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("clicking the scrim calls onDismiss but clicking the card does not", () => {
    const onDismiss = vi.fn();
    const { container } = render(() => (
      <CommandPalette projects={[PROJECT_A]} sessionsByProjectId={{}} onSelect={vi.fn()} onDismiss={onDismiss} />
    ));

    fireEvent.click(container.querySelector(".tw-command-palette") as HTMLElement);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector(".tw-command-palette-scrim") as HTMLElement);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("resets the selection back to the first row when the filtered list shrinks", () => {
    const onSelect = vi.fn();
    render(() => (
      <CommandPalette
        projects={[PROJECT_A, PROJECT_B]}
        sessionsByProjectId={{}}
        onSelect={onSelect}
        onDismiss={vi.fn()}
      />
    ));
    const input = screen.getByLabelText("Search projects and sessions");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // selects the 2nd row (p2)

    fireEvent.input(input, { target: { value: "demo" } }); // only p1 matches now
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "project", projectId: "p1" }));
  });
});
