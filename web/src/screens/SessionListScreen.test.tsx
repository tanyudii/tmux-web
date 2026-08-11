import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../api/errors";
import { createSessionListStore } from "../stores/sessionListStore";
import { SessionListScreen } from "./SessionListScreen";

const SESSION_A = { name: "a", fullName: "proj__a", windows: 1, windowNames: [], attached: true, label: null, favorite: false };
const SESSION_B = { name: "b", fullName: "proj__b", windows: 2, windowNames: [], attached: false, label: "backend", favorite: true };

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    listSessions: vi.fn().mockResolvedValue([SESSION_A, SESSION_B]),
    createSession: vi.fn(),
    getSessionCreationStatus: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    setSessionMeta: vi.fn().mockResolvedValue({ projectId: "proj", sessionSlug: "a", label: null, favorite: true }),
    listTemplates: vi.fn().mockResolvedValue([]),
    createTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    ...overrides,
  };
}

function renderScreen(overrides: Record<string, unknown> = {}) {
  const api = fakeApi(overrides);
  const store = createSessionListStore({ projectId: "proj", api });
  const onOpenSession = vi.fn();
  const onBack = vi.fn();
  render(() => (
    <SessionListScreen store={store} projectName="my-project" onOpenSession={onOpenSession} onBack={onBack} />
  ));
  return { store, api, onOpenSession, onBack };
}

describe("SessionListScreen", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("groups sessions into Favorites and Sessions, and opens one on click", async () => {
    const { store, onOpenSession } = renderScreen();
    await store.load();

    expect(screen.getByText("Favorites")).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^a/ }));
    expect(onOpenSession).toHaveBeenCalledWith(SESSION_A);
  });

  it("navigates back via the nav bar's back control", () => {
    const { onBack } = renderScreen();

    fireEvent.click(screen.getByRole("button", { name: /Projects/ }));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("filters the list by status via the filter bar", async () => {
    const { store } = renderScreen();
    await store.load();

    fireEvent.click(screen.getByRole("button", { name: "Active" }));

    expect(screen.queryByText("Favorites")).toBeNull();
    expect(screen.getByText(/^a$/)).toBeInTheDocument();
  });

  it("creates a session through the New Session sheet", async () => {
    const api = fakeApi({
      createSession: vi.fn().mockResolvedValue({ name: "c", fullName: "proj__c" }),
      getSessionCreationStatus: vi.fn().mockResolvedValue({
        phase: "ready",
        session: { name: "c", fullName: "proj__c", windows: 1, windowNames: [], attached: true, label: null, favorite: false },
      }),
    });
    const store = createSessionListStore({ projectId: "proj", api });
    render(() => <SessionListScreen store={store} projectName="my-project" onOpenSession={vi.fn()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "c" } });
    fireEvent.click(screen.getByText("Create"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(api.createSession).toHaveBeenCalledWith("proj", { name: "c" });
    // Regression test for a bug found live (not by review or the assertion
    // above alone): the sheet must actually close on success, not just
    // have called the API -- see the createEffect in SessionListScreen.tsx.
    expect(screen.queryByText("New Session")).toBeNull();
  });

  it("opens the new session as soon as creation succeeds", async () => {
    const created = { name: "c", fullName: "proj__c", windows: 1, windowNames: [], attached: true, label: null, favorite: false };
    const api = fakeApi({
      createSession: vi.fn().mockResolvedValue({ name: "c", fullName: "proj__c" }),
      getSessionCreationStatus: vi.fn().mockResolvedValue({ phase: "ready", session: created }),
    });
    const store = createSessionListStore({ projectId: "proj", api });
    const onOpenSession = vi.fn();
    render(() => <SessionListScreen store={store} projectName="my-project" onOpenSession={onOpenSession} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "c" } });
    fireEvent.click(screen.getByText("Create"));

    // waitFor rather than a fixed number of `await Promise.resolve()` ticks
    // (the style used by the older tests here): navigation now happens one
    // async hop further out than the API call does, so a hard-coded tick count
    // is both wrong today and silently fragile against any future hop.
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith(created));
  });

  // The counterpart to the above: a failed creation must leave the user on the
  // list with the sheet's error visible, never navigate them into a session
  // that does not exist.
  it("does NOT open a session when creation fails", async () => {
    const api = fakeApi({
      createSession: vi.fn().mockResolvedValue({ name: "c", fullName: "proj__c" }),
      getSessionCreationStatus: vi.fn().mockResolvedValue({ phase: "error", message: "worktree is dirty" }),
    });
    const store = createSessionListStore({ projectId: "proj", api });
    const onOpenSession = vi.fn();
    render(() => <SessionListScreen store={store} projectName="my-project" onOpenSession={onOpenSession} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "c" } });
    fireEvent.click(screen.getByText("Create"));

    // Wait for the failure to actually surface before asserting the negative,
    // otherwise this passes trivially by checking before anything happened.
    await waitFor(() => expect(screen.getByText("worktree is dirty")).toBeInTheDocument());
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it("does NOT close the New Session sheet when creation fails", async () => {
    const api = fakeApi({
      createSession: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const store = createSessionListStore({ projectId: "proj", api });
    render(() => <SessionListScreen store={store} projectName="my-project" onOpenSession={vi.fn()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "c" } });
    fireEvent.click(screen.getByText("Create"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText("New Session")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("edits a session's label through the label sheet", async () => {
    const { store, api } = renderScreen();
    await store.load();

    fireEvent.click(screen.getByRole("button", { name: "Edit label for b" }));
    expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("backend");

    fireEvent.input(screen.getByLabelText("Label"), { target: { value: "infra" } });
    fireEvent.click(screen.getByText("Save"));

    expect(api.setSessionMeta).toHaveBeenCalledWith("proj", "b", "infra", true);
  });

  it("toggles selection mode and bulk-deletes selected sessions", async () => {
    const { store, api } = renderScreen();
    await store.load();

    fireEvent.click(screen.getByRole("button", { name: "Select sessions" }));
    fireEvent.click(screen.getByRole("button", { name: /^a/ }));
    fireEvent.click(screen.getByRole("button", { name: /Delete selected/ }));
    expect(screen.getByText(/Delete 1 session/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.deleteSession).toHaveBeenCalledWith("proj", "a", { force: false });
  });

  it("shows a force-delete confirmation on a 409 when deleting a single session", async () => {
    const { store } = renderScreen({
      deleteSession: vi.fn().mockRejectedValue(new ConflictError("branch not merged")),
    });
    await store.load();
    store.requestDeleteSession(SESSION_A);
    await store.confirmDelete();

    expect(await screen.findByText("branch not merged")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Force delete" })).toBeInTheDocument();
  });
});
