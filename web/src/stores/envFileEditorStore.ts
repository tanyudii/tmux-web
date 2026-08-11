// Ports presentation/EnvFileEditorViewModel.kt -- backs the `.tmux-web-env/`
// file editor dialog (EMB-210). Saving never restarts a running
// environment: the user must explicitly re-run Setup afterward (see the
// Environment menu, task #18e).
//
// Diverges from the Kotlin original in one deliberate way: web/'s
// GET .../env-files (listEnvFiles) returns only filenames, not content --
// content is fetched lazily per file via GET .../env-files/:filename
// (readEnvFile), rather than Kotlin's EnvironmentRepository returning every
// file's content up front. This avoids fetching unused file contents and
// matches how src/env-editor.ts's two-endpoint split is actually shaped.
import { createStore } from "solid-js/store";
import type { ApiClient } from "../api/client";
import type { EnvFileEntry } from "../api/types";
import { toUiMessage } from "./errorMessage";

export interface EnvFileEditorState {
  files: EnvFileEntry[];
  selectedFilename: string | null;
  draftContent: string;
  isLoading: boolean;
  isSaving: boolean;
  errorMessage: string | null;
  savedFilename: string | null;
}

export interface EnvFileEditorStoreDeps {
  projectId: string;
  sessionSlug: string;
  api: Pick<ApiClient, "listEnvFiles" | "readEnvFile" | "writeEnvFile">;
}

export function createEnvFileEditorStore(deps: EnvFileEditorStoreDeps) {
  const { projectId, sessionSlug, api } = deps;

  const [state, setState] = createStore<EnvFileEditorState>({
    files: [],
    selectedFilename: null,
    draftContent: "",
    isLoading: true,
    isSaving: false,
    errorMessage: null,
    savedFilename: null,
  });

  async function loadContent(filename: string): Promise<void> {
    const content = await api.readEnvFile(projectId, sessionSlug, filename);
    setState({ draftContent: content });
  }

  async function start(): Promise<void> {
    setState({ isLoading: true, errorMessage: null });
    try {
      const files = await api.listEnvFiles(projectId, sessionSlug);
      const selected = files[0]?.filename ?? null;
      setState({ files, selectedFilename: selected });
      if (selected) await loadContent(selected);
      setState({ isLoading: false });
    } catch (error) {
      setState({ isLoading: false, errorMessage: toUiMessage(error) });
    }
  }

  async function selectFile(filename: string): Promise<void> {
    setState({ selectedFilename: filename, errorMessage: null, savedFilename: null, isLoading: true });
    try {
      await loadContent(filename);
      setState({ isLoading: false });
    } catch (error) {
      setState({ isLoading: false, errorMessage: toUiMessage(error) });
    }
  }

  function updateDraft(content: string): void {
    setState({ draftContent: content });
  }

  async function save(): Promise<void> {
    const filename = state.selectedFilename;
    if (!filename) return;
    const content = state.draftContent;
    setState({ isSaving: true, errorMessage: null, savedFilename: null });
    try {
      await api.writeEnvFile(projectId, sessionSlug, filename, content);
      setState({ isSaving: false, savedFilename: filename });
    } catch (error) {
      setState({ isSaving: false, errorMessage: toUiMessage(error) });
    }
  }

  function dismissError(): void {
    setState({ errorMessage: null });
  }

  return { state, start, selectFile, updateDraft, save, dismissError };
}

export type EnvFileEditorStore = ReturnType<typeof createEnvFileEditorStore>;
