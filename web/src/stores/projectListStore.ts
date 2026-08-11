// Ports presentation/ProjectListViewModel.kt.
import { createStore } from "solid-js/store";
import type { ApiClient } from "../api/client";
import type { Project } from "../api/types";
import { deleteHandlingConflict } from "./deleteHandlingConflict";
import { toUiMessage } from "./errorMessage";

export interface PendingDelete {
  /** false = first confirm; true = server refused, escalated variant. */
  forced: boolean;
  project: Project;
  message: string;
}

export interface NewProjectState {
  isSaving: boolean;
  errorMessage: string | null;
}

export interface ProjectListState {
  projects: Project[];
  isLoading: boolean;
  errorMessage: string | null;
  pendingDelete: PendingDelete | null;
  // null = the New Project sheet is closed.
  newProject: NewProjectState | null;
}

export interface ProjectListStoreDeps {
  api: Pick<ApiClient, "listProjects" | "createProject" | "deleteProject">;
}

export function createProjectListStore(deps: ProjectListStoreDeps) {
  const [state, setState] = createStore<ProjectListState>({
    projects: [],
    isLoading: false,
    errorMessage: null,
    pendingDelete: null,
    newProject: null,
  });

  async function load(): Promise<void> {
    setState({ isLoading: true, errorMessage: null });
    try {
      const projects = await deps.api.listProjects();
      setState({ projects, isLoading: false });
    } catch (error) {
      setState({ isLoading: false, errorMessage: toUiMessage(error) });
    }
  }

  function showNewProjectSheet(): void {
    setState({ newProject: { isSaving: false, errorMessage: null } });
  }

  function cancelNewProject(): void {
    setState({ newProject: null });
  }

  async function createProject(name: string, repoPath: string): Promise<void> {
    setState("newProject", { isSaving: true, errorMessage: null });
    try {
      const project = await deps.api.createProject({ name, repoPath });
      setState("projects", (projects) => [...projects, project]);
      setState({ newProject: null });
    } catch (error) {
      setState("newProject", { isSaving: false, errorMessage: toUiMessage(error) });
    }
  }

  /**
   * Opens the confirm dialog rather than deleting. Previously the trash icon
   * deleted on the spot and only prompted when the server returned 409, so a
   * project with no live sessions was gone in one tap with no undo.
   *
   * `forced: false` renders the ordinary Delete confirm; confirmDelete below
   * escalates the same dialog if the server does object.
   */
  function requestDeleteProject(project: Project): void {
    setState({
      pendingDelete: {
        project,
        forced: false,
        message: `Delete project "${project.name}"? This removes it from tmux-web; the repository itself is left alone.`,
      },
    });
  }

  /** Runs the delete the dialog is confirming, escalating to force on a 409. */
  async function confirmDelete(): Promise<void> {
    const pending = state.pendingDelete;
    if (!pending) return;
    if (pending.forced) return confirmForceDelete();

    const outcome = await deleteHandlingConflict(pending.project, (force) =>
      deps.api.deleteProject(pending.project.id, { force }),
    );
    if (outcome.kind === "deleted") {
      setState("projects", (projects) => projects.filter((p) => p.id !== pending.project.id));
      setState({ pendingDelete: null });
    } else if (outcome.kind === "conflict") {
      // Not an error to report and dismiss -- a second, escalated question.
      setState("pendingDelete", { forced: true, message: outcome.prompt.message } as Partial<PendingDelete>);
    } else {
      setState({ pendingDelete: null, errorMessage: outcome.message });
    }
  }

  function cancelDelete(): void {
    setState({ pendingDelete: null });
  }

  async function confirmForceDelete(): Promise<void> {
    const pending = state.pendingDelete;
    if (!pending) return;
    try {
      await deps.api.deleteProject(pending.project.id, { force: true });
      setState("projects", (projects) => projects.filter((p) => p.id !== pending.project.id));
      setState({ pendingDelete: null });
    } catch (error) {
      setState({ pendingDelete: null, errorMessage: toUiMessage(error) });
    }
  }

  function dismissError(): void {
    setState({ errorMessage: null });
  }

  return {
    state,
    load,
    showNewProjectSheet,
    cancelNewProject,
    createProject,
    requestDeleteProject,
    confirmDelete,
    cancelDelete,
    confirmForceDelete,
    dismissError,
  };
}

export type ProjectListStore = ReturnType<typeof createProjectListStore>;
