// Ports presentation/ChangesViewModel.kt + DiffViewModel.kt (folded into
// one store -- Kotlin split them only because a fresh DiffViewModel was
// `remember`ed per dialog-open; here `openDiff` is just another field on
// the same store). Tree grouping itself is not re-implemented: it already
// exists in domain/fileTree.ts (buildFileTree, ported in Phase 3) and gets
// called directly by ChangesDialog.tsx from `changes`, matching Kotlin's
// ChangesTree.kt building rows straight from GroupedChanges rather than
// from store state.
import { createStore } from "solid-js/store";
import type { ApiClient } from "../api/client";
import type { ChangedFile, DiffMode, GroupedChanges } from "../api/types";
import { parsedDiffFromAdditions, parseUnifiedDiff, withIntralineHighlights, type ParsedDiff } from "../domain/diffLineParser";
import { toUiMessage } from "./errorMessage";

const POLL_INTERVAL_MS = 5000;

export interface PendingDiscard {
  file: ChangedFile;
  mode: DiffMode;
}

export interface OpenDiffState {
  file: ChangedFile;
  mode: DiffMode;
  isLoading: boolean;
  parsedDiff: ParsedDiff | null;
  isBinary: boolean;
  isUntracked: boolean;
  errorMessage: string | null;
}

export interface ChangesState {
  changes: GroupedChanges | null;
  errorMessage: string | null;
  pendingDiscard: PendingDiscard | null;
  commitMessage: string;
  isCommitting: boolean;
  openDiff: OpenDiffState | null;
}

export interface ChangesStoreDeps {
  projectId: string;
  sessionSlug: string;
  api: Pick<ApiClient, "getChanges" | "getDiff" | "stageFile" | "unstageFile" | "discardFile" | "commitChanges">;
  wait?: (ms: number) => Promise<void>;
}

const realWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createChangesStore(deps: ChangesStoreDeps) {
  const { projectId, sessionSlug, api } = deps;
  const wait = deps.wait ?? realWait;
  let pollEpoch = 0;

  const [state, setState] = createStore<ChangesState>({
    changes: null,
    errorMessage: null,
    pendingDiscard: null,
    commitMessage: "",
    isCommitting: false,
    openDiff: null,
  });

  async function refresh(): Promise<void> {
    try {
      const changes = await api.getChanges(projectId, sessionSlug);
      setState({ changes, errorMessage: null });
    } catch (error) {
      setState({ errorMessage: toUiMessage(error) });
    }
  }

  /** Starts the 5s poll loop; call once per dialog-open, paired with stop(). */
  function start(): void {
    const epoch = ++pollEpoch;
    void refresh();
    void pollLoop(epoch);
  }

  async function pollLoop(epoch: number): Promise<void> {
    for (;;) {
      await wait(POLL_INTERVAL_MS);
      if (epoch !== pollEpoch) return;
      await refresh();
    }
  }

  function stop(): void {
    pollEpoch += 1;
  }

  function dismissError(): void {
    setState({ errorMessage: null });
  }

  async function stage(file: ChangedFile): Promise<void> {
    try {
      await api.stageFile(projectId, sessionSlug, file.path);
      await refresh();
    } catch (error) {
      setState({ errorMessage: toUiMessage(error) });
    }
  }

  async function unstage(file: ChangedFile): Promise<void> {
    try {
      await api.unstageFile(projectId, sessionSlug, file.path);
      await refresh();
    } catch (error) {
      setState({ errorMessage: toUiMessage(error) });
    }
  }

  function requestDiscard(file: ChangedFile, mode: DiffMode): void {
    setState({ pendingDiscard: { file, mode } });
  }

  function cancelDiscard(): void {
    setState({ pendingDiscard: null });
  }

  async function confirmDiscard(): Promise<void> {
    const pending = state.pendingDiscard;
    if (!pending) return;
    try {
      await api.discardFile(projectId, sessionSlug, pending.file.path, pending.mode);
      setState({ pendingDiscard: null });
      await refresh();
    } catch (error) {
      setState({ pendingDiscard: null, errorMessage: toUiMessage(error) });
    }
  }

  function updateCommitMessage(message: string): void {
    setState({ commitMessage: message });
  }

  async function commit(): Promise<void> {
    if (state.commitMessage.trim() === "" || state.isCommitting) return;
    setState({ isCommitting: true });
    try {
      await api.commitChanges(projectId, sessionSlug, state.commitMessage.trim());
      setState({ commitMessage: "", isCommitting: false });
      await refresh();
    } catch (error) {
      setState({ isCommitting: false, errorMessage: toUiMessage(error) });
    }
  }

  async function openDiffFor(file: ChangedFile, mode: DiffMode): Promise<void> {
    setState({
      openDiff: { file, mode, isLoading: true, parsedDiff: null, isBinary: false, isUntracked: false, errorMessage: null },
    });
    try {
      const fileDiff = await api.getDiff(projectId, sessionSlug, file.path, mode);
      if (fileDiff.isBinary) {
        setState("openDiff", { isLoading: false, isBinary: true });
        return;
      }
      const parsed = withIntralineHighlights(
        fileDiff.isUntracked ? parsedDiffFromAdditions(fileDiff.diff) : parseUnifiedDiff(fileDiff.diff),
      );
      setState("openDiff", {
        isLoading: false,
        parsedDiff: parsed,
        isUntracked: fileDiff.isUntracked,
      });
    } catch (error) {
      setState("openDiff", { isLoading: false, errorMessage: toUiMessage(error) });
    }
  }

  function closeDiff(): void {
    setState({ openDiff: null });
  }

  return {
    state,
    start,
    stop,
    refresh,
    dismissError,
    stage,
    unstage,
    requestDiscard,
    cancelDiscard,
    confirmDiscard,
    updateCommitMessage,
    commit,
    openDiffFor,
    closeDiff,
  };
}

export type ChangesStore = ReturnType<typeof createChangesStore>;
