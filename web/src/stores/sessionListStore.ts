// Ports presentation/SessionListViewModel.kt + its SessionBulkDeleteController
// delegate (folded into the same store here -- Kotlin split it out only to
// share `_state` between two classes, which a single Solid store already
// gives us for free).
import { createStore } from "solid-js/store";
import type { ApiClient } from "../api/client";
import type { ProjectSession, SessionMeta, SessionTemplate } from "../api/types";
import { filterSessions, type SessionStatusFilter } from "../domain/sessionFilter";
import { deleteHandlingConflict } from "./deleteHandlingConflict";
import { toUiMessage } from "./errorMessage";

const SESSION_CREATION_POLL_INTERVAL_MS = 1000;

export interface PendingForceDelete {
  /** false = first confirm; true = server refused, escalated variant. */
  forced: boolean;
  session: ProjectSession;
  message: string;
}

export interface SessionCreationState {
  isSaving: boolean;
  progressMessage: string | null;
  errorMessage: string | null;
}

export interface PendingBulkDelete {
  names: string[];
}

export interface PendingBulkForceDelete {
  sessions: ProjectSession[];
}

export interface SessionListState {
  sessions: ProjectSession[];
  isLoading: boolean;
  errorMessage: string | null;
  pendingDelete: PendingForceDelete | null;
  sessionCreation: SessionCreationState | null;
  isSelectionMode: boolean;
  selectedNames: string[];
  statusFilter: SessionStatusFilter;
  branchQuery: string;
  pendingBulkDelete: PendingBulkDelete | null;
  pendingBulkForceDelete: PendingBulkForceDelete | null;
  // EMB-220 (task #18b): this project's saved session-creation templates,
  // offered as one-click fill-ins in NewSessionSheet.
  templates: SessionTemplate[];
}

export interface SessionListStoreDeps {
  projectId: string;
  api: Pick<
    ApiClient,
    | "listSessions"
    | "createSession"
    | "getSessionCreationStatus"
    | "deleteSession"
    | "setSessionMeta"
    | "listTemplates"
    | "createTemplate"
    | "deleteTemplate"
  >;
  // Injectable so a poll loop never actually waits in tests -- vi's fake
  // timers drive the real setTimeout underneath.
  wait?: (ms: number) => Promise<void>;
}

const realWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createSessionListStore(deps: SessionListStoreDeps) {
  const { projectId, api } = deps;
  const wait = deps.wait ?? realWait;
  // Bumped on cancelSessionCreation() so a still-in-flight poll loop from a
  // cancelled creation can tell it's stale and stop touching state.
  let creationEpoch = 0;

  const [state, setState] = createStore<SessionListState>({
    sessions: [],
    isLoading: false,
    errorMessage: null,
    pendingDelete: null,
    sessionCreation: null,
    isSelectionMode: false,
    selectedNames: [],
    statusFilter: "all",
    branchQuery: "",
    pendingBulkDelete: null,
    pendingBulkForceDelete: null,
    templates: [],
  });

  function filteredSessions(): ProjectSession[] {
    return filterSessions(state.sessions, state.statusFilter, state.branchQuery);
  }

  async function load(): Promise<void> {
    setState({ isLoading: true, errorMessage: null });
    try {
      const sessions = await api.listSessions(projectId);
      setState({ sessions, isLoading: false });
    } catch (error) {
      setState({ isLoading: false, errorMessage: toUiMessage(error) });
    }
  }

  /**
   * Opens the confirm dialog rather than deleting. Same reasoning as
   * projectListStore.requestDeleteProject: the row's trash icon used to destroy
   * the session on a single tap unless the server happened to return 409.
   */
  function requestDeleteSession(session: ProjectSession): void {
    setState({
      pendingDelete: {
        session,
        forced: false,
        message: `Delete session "${session.name}"? Its tmux session and git worktree are removed.`,
      },
    });
  }

  /** Runs the delete the dialog is confirming, escalating to force on a 409. */
  async function confirmDelete(): Promise<void> {
    const pending = state.pendingDelete;
    if (!pending) return;
    if (pending.forced) return confirmForceDelete();

    const outcome = await deleteHandlingConflict(pending.session, (force) =>
      api.deleteSession(projectId, pending.session.name, { force, deleteBranch: true }),
    );
    if (outcome.kind === "deleted") {
      setState("sessions", (sessions) => sessions.filter((s) => s.name !== pending.session.name));
      setState({ pendingDelete: null });
    } else if (outcome.kind === "conflict") {
      setState("pendingDelete", { forced: true, message: outcome.prompt.message } as Partial<PendingForceDelete>);
    } else {
      setState({ pendingDelete: null, errorMessage: outcome.message });
    }
  }

  function cancelForceDelete(): void {
    setState({ pendingDelete: null });
  }

  async function confirmForceDelete(): Promise<void> {
    const pending = state.pendingDelete;
    if (!pending) return;
    try {
      await api.deleteSession(projectId, pending.session.name, { force: true, deleteBranch: true });
      setState("sessions", (sessions) => sessions.filter((s) => s.name !== pending.session.name));
      setState({ pendingDelete: null });
    } catch (error) {
      setState({ pendingDelete: null, errorMessage: toUiMessage(error) });
    }
  }

  function dismissError(): void {
    setState({ errorMessage: null });
  }

  function setStatusFilter(filter: SessionStatusFilter): void {
    setState({ statusFilter: filter });
  }

  function setBranchQuery(query: string): void {
    setState({ branchQuery: query });
  }

  async function setSessionMeta(session: ProjectSession, label: string | null, favorite: boolean): Promise<void> {
    try {
      const meta: SessionMeta = await api.setSessionMeta(projectId, session.name, label ?? undefined, favorite);
      setState("sessions", (s) => s.name === session.name, {
        label: meta.label ?? null,
        favorite: meta.favorite,
      });
    } catch (error) {
      setState({ errorMessage: toUiMessage(error) });
    }
  }

  /**
   * Returns the created session once it is ready, or null if creation failed or
   * was cancelled. The return value is what lets the caller navigate straight
   * into the new session -- the store stays UI-agnostic and does no routing of
   * its own, so SessionListScreen decides what "open it" means (see its
   * onCreate handler).
   *
   * Null rather than throwing on failure: the error is already surfaced through
   * `state.sessionCreation.errorMessage`, which the sheet renders, and a caller
   * that only wants to know "can I navigate now?" should not have to catch.
   */
  async function createSession(name: string, startupCommand?: string): Promise<ProjectSession | null> {
    const epoch = ++creationEpoch;
    setState({ sessionCreation: { isSaving: true, progressMessage: "Creating…", errorMessage: null } });
    try {
      const pending = await api.createSession(projectId, { name, startupCommand });
      return await pollSessionCreation(pending.name, epoch);
    } catch (error) {
      if (epoch !== creationEpoch) return null;
      setState("sessionCreation", { isSaving: false, progressMessage: null, errorMessage: toUiMessage(error) });
      return null;
    }
  }

  // ---- Session templates (EMB-220, task #18b) ----

  /** A failed load must never block session creation -- leave templates empty on failure. */
  async function loadTemplates(): Promise<void> {
    try {
      const templates = await api.listTemplates(projectId);
      setState({ templates });
    } catch {
      // Silently ignored -- see doc comment.
    }
  }

  async function saveAsTemplate(name: string, startupCommand?: string): Promise<void> {
    try {
      const template = await api.createTemplate(projectId, { name, startupCommand });
      setState("templates", (templates) => [...templates, template]);
    } catch (error) {
      setState({ errorMessage: toUiMessage(error) });
    }
  }

  async function deleteTemplate(templateId: string): Promise<void> {
    try {
      await api.deleteTemplate(projectId, templateId);
      setState("templates", (templates) => templates.filter((t) => t.id !== templateId));
    } catch (error) {
      setState({ errorMessage: toUiMessage(error) });
    }
  }

  /**
   * Resolves with the ready session, or null on error/cancellation. Returning
   * null for a cancelled epoch matters: a caller must not navigate into a
   * session the user just cancelled out of.
   */
  async function pollSessionCreation(sessionSlug: string, epoch: number): Promise<ProjectSession | null> {
    for (;;) {
      if (epoch !== creationEpoch) return null;
      const status = await api.getSessionCreationStatus(projectId, sessionSlug);
      if (epoch !== creationEpoch) return null;
      if (status.phase === "ready") {
        if (status.session) setState("sessions", (sessions) => [...sessions, status.session!]);
        setState({ sessionCreation: null });
        // `session` is optional in the status payload. When it is absent there
        // is nothing to navigate to, so report success-without-a-target rather
        // than inventing a ProjectSession from the slug -- a fabricated one
        // would carry a wrong fullName into the terminal screen's route state.
        return status.session ?? null;
      }
      if (status.phase === "error") {
        setState("sessionCreation", {
          isSaving: false,
          progressMessage: null,
          errorMessage: status.message ?? "Session creation failed.",
        });
        return null;
      }
      setState("sessionCreation", "progressMessage", status.message ?? "Creating…");
      await wait(SESSION_CREATION_POLL_INTERVAL_MS);
    }
  }

  function cancelSessionCreation(): void {
    creationEpoch += 1;
    setState({ sessionCreation: null });
  }

  function toggleSelectionMode(): void {
    setState({ isSelectionMode: !state.isSelectionMode, selectedNames: [] });
  }

  function toggleSessionSelected(name: string): void {
    setState(
      "selectedNames",
      state.selectedNames.includes(name)
        ? state.selectedNames.filter((n) => n !== name)
        : [...state.selectedNames, name],
    );
  }

  function requestBulkDelete(): void {
    if (state.selectedNames.length === 0) return;
    setState({ pendingBulkDelete: { names: [...state.selectedNames] } });
  }

  function cancelBulkDelete(): void {
    setState({ pendingBulkDelete: null });
  }

  async function confirmBulkDelete(): Promise<void> {
    const pending = state.pendingBulkDelete;
    if (!pending) return;
    const conflicted: ProjectSession[] = [];
    for (const name of pending.names) {
      const session = state.sessions.find((s) => s.name === name);
      if (!session) continue;
      const outcome = await deleteHandlingConflict(session, (force) => api.deleteSession(projectId, name, { force, deleteBranch: true }));
      if (outcome.kind === "deleted") {
        setState("sessions", (sessions) => sessions.filter((s) => s.name !== name));
      } else if (outcome.kind === "conflict") {
        conflicted.push(outcome.prompt.target);
      }
    }
    setState({ pendingBulkDelete: null, isSelectionMode: false, selectedNames: [] });
    if (conflicted.length > 0) {
      setState({ pendingBulkForceDelete: { sessions: conflicted } });
    }
  }

  function cancelBulkForceDelete(): void {
    setState({ pendingBulkForceDelete: null });
  }

  async function confirmBulkForceDelete(): Promise<void> {
    const pending = state.pendingBulkForceDelete;
    if (!pending) return;
    for (const session of pending.sessions) {
      try {
        await api.deleteSession(projectId, session.name, { force: true, deleteBranch: true });
        setState("sessions", (sessions) => sessions.filter((s) => s.name !== session.name));
      } catch (error) {
        setState({ errorMessage: toUiMessage(error) });
      }
    }
    setState({ pendingBulkForceDelete: null });
  }

  return {
    state,
    filteredSessions,
    load,
    requestDeleteSession,
    confirmDelete,
    cancelForceDelete,
    confirmForceDelete,
    dismissError,
    setStatusFilter,
    setBranchQuery,
    setSessionMeta,
    createSession,
    cancelSessionCreation,
    loadTemplates,
    saveAsTemplate,
    deleteTemplate,
    toggleSelectionMode,
    toggleSessionSelected,
    requestBulkDelete,
    cancelBulkDelete,
    confirmBulkDelete,
    cancelBulkForceDelete,
    confirmBulkForceDelete,
  };
}

export type SessionListStore = ReturnType<typeof createSessionListStore>;
