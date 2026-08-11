// Ports presentation/DirectoryPickerViewModel.kt -- drives the "choose a repo
// folder" picker (GET /api/browse). A failed open()/up()/retry() leaves the
// previously loaded listing in place (only errorMessage changes) so a
// permission error on one folder doesn't strand the user with an empty
// screen, matching the Kotlin original's comment.
import { createStore } from "solid-js/store";
import type { ApiClient } from "../api/client";
import type { DirectoryListing } from "../api/types";
import { toUiMessage } from "./errorMessage";

type DirectoryEntry = DirectoryListing["entries"][number];

export interface DirectoryPickerState {
  currentPath: string | null;
  parentPath: string | null;
  isCurrentGitRepo: boolean;
  entries: DirectoryEntry[];
  truncated: boolean;
  isLoading: boolean;
  errorMessage: string | null;
}

export interface DirectoryPickerStoreDeps {
  api: Pick<ApiClient, "browseDirectory">;
}

export function createDirectoryPickerStore(deps: DirectoryPickerStoreDeps) {
  const { api } = deps;
  let lastRequestedPath: string | undefined;

  const [state, setState] = createStore<DirectoryPickerState>({
    currentPath: null,
    parentPath: null,
    isCurrentGitRepo: false,
    entries: [],
    truncated: false,
    isLoading: false,
    errorMessage: null,
  });

  async function load(path: string | undefined): Promise<void> {
    lastRequestedPath = path;
    setState({ isLoading: true, errorMessage: null });
    try {
      const listing = await api.browseDirectory(path);
      setState({
        currentPath: listing.path,
        parentPath: listing.parentPath ?? null,
        isCurrentGitRepo: listing.isGitRepo,
        entries: listing.entries,
        truncated: listing.truncated,
        isLoading: false,
        errorMessage: null,
      });
    } catch (error) {
      setState({ isLoading: false, errorMessage: toUiMessage(error) });
    }
  }

  /** Kicks off the initial (repo-root-relative) listing; call once when the picker mounts. */
  function start(): void {
    void load(undefined);
  }

  function open(entry: DirectoryEntry): void {
    void load(entry.path);
  }

  function up(): void {
    if (state.parentPath) void load(state.parentPath);
  }

  /** Re-issues the last attempted open()/up()/initial request, e.g. after a transient failure. */
  function retry(): void {
    void load(lastRequestedPath);
  }

  return { state, start, open, up, retry };
}

export type DirectoryPickerStore = ReturnType<typeof createDirectoryPickerStore>;
