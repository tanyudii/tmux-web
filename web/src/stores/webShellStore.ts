// Ports presentation/WebShellViewModel.kt. Deliberately does NOT delegate
// to projectListStore/sessionListStore -- same call the Kotlin original
// makes: the desktop sidebar needs several projects' sessions expanded
// and visible at once (`sessionsByProjectId: Record<id, Session[]>`), a
// different shape than mobile's one-project-at-a-time drill-down list.
//
// `loadAllSessions()` below backs the command palette (#18g); session
// templates (this file's other #18 item) are ported below (#18b).
import { createStore } from "solid-js/store";
import type { ApiClient } from "../api/client";
import type { Project, ProjectSession, SessionTemplate } from "../api/types";
import { deleteHandlingConflict } from "./deleteHandlingConflict";
import { toUiMessage } from "./errorMessage";

const SESSION_CREATION_POLL_INTERVAL_MS = 1000;

export interface NewProjectDialogState {
  isSaving: boolean;
  errorMessage: string | null;
}

export interface NewSessionDialogState {
  projectId: string;
  isSaving: boolean;
  progressMessage: string | null;
  errorMessage: string | null;
  // EMB-220 (task #18b): this project's saved session-creation templates.
  templates: SessionTemplate[];
}

export interface PendingDeleteProject {
  kind: "project";
  project: Project;
  forced: boolean;
  message?: string;
}

export interface PendingDeleteSession {
  kind: "session";
  projectId: string;
  session: ProjectSession;
  forced: boolean;
  message?: string;
}

export type PendingDelete = PendingDeleteProject | PendingDeleteSession;

export interface WebShellState {
  projects: Project[];
  isLoadingProjects: boolean;
  expandedProjectIds: string[];
  sessionsByProjectId: Record<string, ProjectSession[]>;
  loadingSessionsForProjectIds: string[];
  selectedProjectId: string | null;
  selectedSessionName: string | null;
  sidebarCollapsed: boolean;
  errorMessage: string | null;
  newProjectDialog: NewProjectDialogState | null;
  newSessionDialog: NewSessionDialogState | null;
  pendingDelete: PendingDelete | null;
}

export interface WebShellStoreDeps {
  api: Pick<
    ApiClient,
    | "listProjects"
    | "createProject"
    | "deleteProject"
    | "listSessions"
    | "createSession"
    | "getSessionCreationStatus"
    | "deleteSession"
    | "isBranchMerged"
    | "listTemplates"
    | "createTemplate"
    | "deleteTemplate"
  >;
  wait?: (ms: number) => Promise<void>;
}

const realWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createWebShellStore(deps: WebShellStoreDeps) {
  const { api } = deps;
  const wait = deps.wait ?? realWait;
  let creationEpoch = 0;

  const [state, setState] = createStore<WebShellState>({
    projects: [],
    isLoadingProjects: false,
    expandedProjectIds: [],
    sessionsByProjectId: {},
    loadingSessionsForProjectIds: [],
    selectedProjectId: null,
    selectedSessionName: null,
    sidebarCollapsed: false,
    errorMessage: null,
    newProjectDialog: null,
    newSessionDialog: null,
    pendingDelete: null,
  });

  function selectedProject(): Project | null {
    return state.projects.find((p) => p.id === state.selectedProjectId) ?? null;
  }

  function selectedSession(): ProjectSession | null {
    if (!state.selectedProjectId) return null;
    const sessions = state.sessionsByProjectId[state.selectedProjectId] ?? [];
    return sessions.find((s) => s.name === state.selectedSessionName) ?? null;
  }

  function hasOpenDialog(): boolean {
    return state.newProjectDialog !== null || state.newSessionDialog !== null || state.pendingDelete !== null;
  }

  async function loadProjects(): Promise<void> {
    setState({ isLoadingProjects: true, errorMessage: null });
    try {
      const projects = await api.listProjects();
      setState({ projects, isLoadingProjects: false });
      // Prefetch every project's sessions so the sidebar's "N session(s)"
      // count is real from the start. It used to be populated only when a
      // project was expanded, so an unexpanded project rendered a confident
      // "0 session(s)" for data that had simply never been fetched -- wrong
      // for every project that actually had sessions.
      //
      // Deliberately not awaited: the project rows should paint immediately
      // and fill their counts in, rather than the whole sidebar waiting.
      // Measured against the real server with 5 projects: ~4ms each, 19ms for
      // all of them in parallel, so this is not a load worth deferring.
      loadAllSessions();
    } catch (error) {
      setState({ isLoadingProjects: false, errorMessage: toUiMessage(error) });
    }
  }

  async function loadSessionsFor(projectId: string): Promise<void> {
    setState("loadingSessionsForProjectIds", (ids) => [...ids, projectId]);
    try {
      const sessions = await api.listSessions(projectId);
      setState("sessionsByProjectId", projectId, sessions);
    } catch (error) {
      setState({ errorMessage: toUiMessage(error) });
    } finally {
      setState("loadingSessionsForProjectIds", (ids) => ids.filter((id) => id !== projectId));
    }
  }

  function toggleProject(projectId: string): void {
    const expanded = state.expandedProjectIds.includes(projectId);
    setState(
      "expandedProjectIds",
      expanded ? state.expandedProjectIds.filter((id) => id !== projectId) : [...state.expandedProjectIds, projectId],
    );
    if (!expanded && !state.sessionsByProjectId[projectId]) void loadSessionsFor(projectId);
  }

  function selectProject(projectId: string): void {
    setState({ selectedProjectId: projectId, selectedSessionName: null });
    if (!state.sessionsByProjectId[projectId]) void loadSessionsFor(projectId);
  }

  /**
   * Drops back to the project's empty state. Used when a session ends beneath
   * us (its last tmux window was closed), where keeping it selected would keep
   * a dead terminal on screen.
   */
  function clearSelectedSession(): void {
    setState({ selectedSessionName: null });
  }

  /**
   * Whether this project's session list has actually been fetched. Callers need
   * this to tell "loaded, and it has none" from "not fetched yet" -- rendering
   * both as 0 is what made the count look broken.
   */
  function hasLoadedSessions(projectId: string): boolean {
    return state.sessionsByProjectId[projectId] !== undefined;
  }

  function selectSession(projectId: string, sessionName: string): void {
    setState({ selectedProjectId: projectId, selectedSessionName: sessionName });
  }

  function toggleSidebarCollapsed(): void {
    setState({ sidebarCollapsed: !state.sidebarCollapsed });
  }

  async function refreshSessions(projectId: string): Promise<void> {
    await loadSessionsFor(projectId);
  }

  /**
   * Eagerly loads sessions for every project not yet loaded. Two callers:
   *
   *  - the command palette (EMB-218, #18g), which needs a complete searchable
   *    project+session list the moment it opens;
   *  - loadProjects above, so the sidebar's "N session(s)" count is real
   *    without waiting for the user to expand each project.
   *
   * Deliberately does NOT touch expandedProjectIds, so neither caller visually
   * expands sidebar rows the user hasn't clicked (see WebShellViewModel.kt's
   * loadAllSessions doc comment). Already-loaded projects are skipped, so the
   * two callers never duplicate each other's requests.
   */
  function loadAllSessions(): void {
    const loaded = new Set(Object.keys(state.sessionsByProjectId));
    for (const project of state.projects) {
      if (!loaded.has(project.id)) void loadSessionsFor(project.id);
    }
  }

  function dismissError(): void {
    setState({ errorMessage: null });
  }

  // ---- New project ----

  function showNewProjectDialog(): void {
    setState({ newProjectDialog: { isSaving: false, errorMessage: null } });
  }

  function cancelNewProjectDialog(): void {
    setState({ newProjectDialog: null });
  }

  async function createProject(name: string, repoPath: string): Promise<void> {
    setState("newProjectDialog", { isSaving: true, errorMessage: null });
    try {
      const project = await api.createProject({ name, repoPath });
      setState("projects", (projects) => [...projects, project]);
      setState({ newProjectDialog: null });
    } catch (error) {
      setState("newProjectDialog", { isSaving: false, errorMessage: toUiMessage(error) });
    }
  }

  // ---- New session ----

  function showNewSessionDialog(projectId: string): void {
    setState({
      newSessionDialog: { projectId, isSaving: false, progressMessage: null, errorMessage: null, templates: [] },
    });
    void loadTemplatesForNewSessionDialog(projectId);
  }

  /**
   * A failed load must never block session creation itself -- silently
   * leaves the dialog's template list empty on failure (see
   * WebShellViewModel.kt's showNewSessionDialog). Re-checks the dialog is
   * still open for the same project before writing, in case the user
   * cancelled or switched projects while this was in flight.
   */
  async function loadTemplatesForNewSessionDialog(projectId: string): Promise<void> {
    try {
      const templates = await api.listTemplates(projectId);
      if (state.newSessionDialog?.projectId !== projectId) return;
      setState("newSessionDialog", { templates });
    } catch {
      // Silently ignored -- see doc comment above.
    }
  }

  function cancelNewSessionDialog(): void {
    setState({ newSessionDialog: null });
  }

  async function createSession(name: string, startupCommand?: string): Promise<void> {
    const dialog = state.newSessionDialog;
    if (!dialog) return;
    const epoch = ++creationEpoch;
    setState("newSessionDialog", { isSaving: true, progressMessage: "Creating…", errorMessage: null });
    try {
      const pending = await api.createSession(dialog.projectId, { name, startupCommand });
      await pollSessionCreation(dialog.projectId, pending.name, epoch);
    } catch (error) {
      if (epoch !== creationEpoch) return;
      setState("newSessionDialog", { isSaving: false, progressMessage: null, errorMessage: toUiMessage(error) });
    }
  }

  // ---- Session templates (EMB-220, task #18b) ----

  async function saveAsTemplate(name: string, startupCommand?: string): Promise<void> {
    const dialog = state.newSessionDialog;
    if (!dialog) return;
    try {
      const template = await api.createTemplate(dialog.projectId, { name, startupCommand });
      // Re-check the dialog is still the same open one before writing --
      // it may have been cancelled while this request was in flight. Not
      // just "still non-null": setState("newSessionDialog", partialObject)
      // merges into whatever is currently there, which would wrongly
      // resurrect a `{}` in place of `null` if the dialog had closed.
      if (state.newSessionDialog !== dialog) return;
      setState("newSessionDialog", "templates", (templates) => [...templates, template]);
    } catch (error) {
      if (state.newSessionDialog !== dialog) return;
      setState("newSessionDialog", "errorMessage", toUiMessage(error));
    }
  }

  async function deleteTemplate(templateId: string): Promise<void> {
    const dialog = state.newSessionDialog;
    if (!dialog) return;
    try {
      await api.deleteTemplate(dialog.projectId, templateId);
      if (state.newSessionDialog !== dialog) return;
      setState("newSessionDialog", "templates", (templates) => templates.filter((t) => t.id !== templateId));
    } catch (error) {
      if (state.newSessionDialog !== dialog) return;
      setState("newSessionDialog", "errorMessage", toUiMessage(error));
    }
  }

  async function pollSessionCreation(projectId: string, sessionSlug: string, epoch: number): Promise<void> {
    for (;;) {
      if (epoch !== creationEpoch) return;
      const status = await api.getSessionCreationStatus(projectId, sessionSlug);
      if (epoch !== creationEpoch) return;
      if (status.phase === "ready") {
        if (status.session) {
          setState("sessionsByProjectId", projectId, (sessions) => [...(sessions ?? []), status.session!]);
        }
        setState({ newSessionDialog: null });
        return;
      }
      if (status.phase === "error") {
        setState("newSessionDialog", {
          isSaving: false,
          progressMessage: null,
          errorMessage: status.message ?? "Session creation failed.",
        });
        return;
      }
      setState("newSessionDialog", "progressMessage", status.message ?? "Creating…");
      await wait(SESSION_CREATION_POLL_INTERVAL_MS);
    }
  }

  // ---- Delete (project or session), with the two-tier unmerged-branch confirm ----

  /**
   * Opens the confirm dialog. It used to delete immediately and only prompt if
   * the server came back with a 409 -- so deleting a project with no active
   * sessions (the common case) happened on a single click of a trash icon,
   * with no confirmation and no undo.
   *
   * `forced: false` renders the ordinary "Delete" confirm; confirmPendingDelete
   * escalates the same dialog to the force variant if the server does object.
   */
  function requestDeleteProject(project: Project): void {
    setState({
      pendingDelete: {
        kind: "project",
        project,
        forced: false,
        message: `Delete project "${project.name}"? This removes it from tmux-web; the repository itself is left alone.`,
      },
    });
  }

  /** Same reasoning as requestDeleteProject: confirm first, escalate later. */
  function requestDeleteSession(projectId: string, session: ProjectSession): void {
    setState({
      pendingDelete: {
        kind: "session",
        projectId,
        session,
        forced: false,
        message: `Delete session "${session.name}"? Its tmux session, git worktree, and branch are removed.`,
      },
    });
  }

  function cancelPendingDelete(): void {
    setState({ pendingDelete: null });
  }


  async function confirmPendingDelete(): Promise<void> {
    const pending = state.pendingDelete;
    if (!pending) return;

    if (pending.kind === "project") {
      // First confirm: try a normal delete. A 409 means the project still has
      // live sessions, which is not an error to report but a second, escalated
      // question -- so the dialog stays open and swaps to its force variant
      // rather than closing and surfacing a banner.
      if (!pending.forced) {
        const outcome = await deleteHandlingConflict(pending.project, (force) =>
          api.deleteProject(pending.project.id, { force }),
        );
        if (outcome.kind === "deleted") {
          setState("projects", (projects) => projects.filter((p) => p.id !== pending.project.id));
          setState({ pendingDelete: null });
        } else if (outcome.kind === "conflict") {
          setState("pendingDelete", { forced: true, message: outcome.prompt.message } as Partial<PendingDeleteProject>);
        } else {
          setState({ pendingDelete: null, errorMessage: outcome.message });
        }
        return;
      }

      try {
        await api.deleteProject(pending.project.id, { force: true });
        setState("projects", (projects) => projects.filter((p) => p.id !== pending.project.id));
        setState({ pendingDelete: null });
      } catch (error) {
        setState({ pendingDelete: null, errorMessage: toUiMessage(error) });
      }
      return;
    }

    // Same first-confirm step as the project branch above. The branch is
    // always deleted together with the session -- no opt-in checkbox and no
    // unmerged-branch second confirm (deliberate product decision).
    if (!pending.forced) {
      const outcome = await deleteHandlingConflict(pending.session, (force) =>
        api.deleteSession(pending.projectId, pending.session.name, { force, deleteBranch: true }),
      );
      if (outcome.kind === "deleted") {
        setState("sessionsByProjectId", pending.projectId, (sessions) =>
          (sessions ?? []).filter((sess) => sess.name !== pending.session.name),
        );
        if (state.selectedSessionName === pending.session.name) setState({ selectedSessionName: null });
        setState({ pendingDelete: null });
      } else if (outcome.kind === "conflict") {
        setState("pendingDelete", { forced: true, message: outcome.prompt.message } as Partial<PendingDeleteSession>);
      } else {
        setState({ pendingDelete: null, errorMessage: outcome.message });
      }
      return;
    }

    try {
      await api.deleteSession(pending.projectId, pending.session.name, { force: true, deleteBranch: true });
      setState("sessionsByProjectId", pending.projectId, (sessions) =>
        (sessions ?? []).filter((s) => s.name !== pending.session.name),
      );
      if (state.selectedSessionName === pending.session.name) {
        setState({ selectedSessionName: null });
      }
      setState({ pendingDelete: null });
    } catch (error) {
      setState({ pendingDelete: null, errorMessage: toUiMessage(error) });
    }
  }

  return {
    state,
    selectedProject,
    selectedSession,
    hasOpenDialog,
    loadProjects,
    toggleProject,
    selectProject,
    selectSession,
    hasLoadedSessions,
    clearSelectedSession,
    toggleSidebarCollapsed,
    refreshSessions,
    loadAllSessions,
    dismissError,
    showNewProjectDialog,
    cancelNewProjectDialog,
    createProject,
    showNewSessionDialog,
    cancelNewSessionDialog,
    createSession,
    saveAsTemplate,
    deleteTemplate,
    requestDeleteProject,
    requestDeleteSession,
    cancelPendingDelete,
    confirmPendingDelete,
  };
}

export type WebShellStore = ReturnType<typeof createWebShellStore>;
