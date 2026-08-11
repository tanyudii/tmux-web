// "Choose a folder" modal for the New Project sheet's repo-path field --
// ports kmp/.../ui/components/TmuxDirectoryPickerDialog.kt + ui/web/
// RepoPathPicker.kt (folded into one file: the Kotlin split exists only
// because RepoPathPicker owns a remembered ViewModel scoped to one picker
// session; here the caller owns the DirectoryPickerStore instead, matching
// this codebase's store-per-feature convention -- see NewProjectSheet.tsx).
import { For, Show, onMount } from "solid-js";
import { Button, IconButton, ListRow, StatusBadge } from "../ui";
import type { DirectoryPickerStore } from "../stores/directoryPickerStore";

export interface DirectoryPickerDialogProps {
  store: DirectoryPickerStore;
  onPicked: (path: string) => void;
  onCancel: () => void;
}

const MAX_PATH_DISPLAY_LENGTH = 44;

// Keeps the tail of the path visible (the most relevant part) instead of the
// default start-ellipsis truncation.
function truncatePathForDisplay(path: string): string {
  return path.length <= MAX_PATH_DISPLAY_LENGTH ? path : `…${path.slice(-(MAX_PATH_DISPLAY_LENGTH - 1))}`;
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 4.5a1 1 0 011-1h3.2l1 1.2H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4.5z"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10 4l-4 4 4 4"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 6.5v3.5M9 12.2h.01M8.1 2.9L1.9 13.6a1 1 0 00.87 1.5h12.46a1 1 0 00.87-1.5L9.9 2.9a1 1 0 00-1.74 0z"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function DirectoryPickerDialog(props: DirectoryPickerDialogProps) {
  onMount(() => props.store.start());

  const state = () => props.store.state;
  const canConfirm = () => state().isCurrentGitRepo && state().currentPath !== null;

  function confirm(): void {
    const path = state().currentPath;
    if (path) props.onPicked(path);
  }

  return (
    <div class="tw-sheet-scrim" onClick={() => props.onCancel()}>
      <div class="tw-dir-picker" onClick={(event) => event.stopPropagation()}>
        <div class="tw-dir-picker__header">
          <span class="tw-dir-picker__header-icon" aria-hidden="true">
            <FolderIcon />
          </span>
          <span class="tw-dir-picker__title">Choose a folder</span>
          <IconButton icon={<CloseIcon />} label="Cancel" size="sm" onClick={() => props.onCancel()} />
        </div>

        <div class="tw-dir-picker__path-row">
          <IconButton
            icon={<ArrowLeftIcon />}
            label="Up one level"
            size="sm"
            disabled={!state().parentPath}
            onClick={() => props.store.up()}
          />
          <span class="tw-dir-picker__path">{state().currentPath ? truncatePathForDisplay(state().currentPath!) : "…"}</span>
        </div>

        <div class="tw-dir-picker__content">
          <Show when={state().isLoading && state().currentPath === null}>
            <div class="tw-dir-picker__hint">
              <span class="tw-dir-picker__spinner" aria-hidden="true" />
            </div>
          </Show>
          <Show when={state().errorMessage}>
            {(message) => (
              <div class="tw-dir-picker__hint">
                <AlertIcon />
                <p class="tw-dir-picker__error">{message()}</p>
                <Button label="Retry" variant="ghost" onClick={() => props.store.retry()} />
              </div>
            )}
          </Show>
          <Show when={!state().isLoading && !state().errorMessage && state().entries.length === 0}>
            <div class="tw-dir-picker__hint">
              <p class="tw-dir-picker__empty">No subfolders here.</p>
            </div>
          </Show>
          <Show when={!state().errorMessage && state().entries.length > 0}>
            <div class="tw-dir-picker__list">
              <For each={state().entries}>
                {(entry) => (
                  <ListRow
                    title={entry.name}
                    icon={<FolderIcon />}
                    chevron={false}
                    trailing={entry.isGitRepo ? <StatusBadge label="git" tone="staged" mono /> : undefined}
                    onClick={() => props.store.open(entry)}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>

        <Show when={state().truncated}>
          <p class="tw-dir-picker__truncated-hint">Showing the first entries only — this folder has more.</p>
        </Show>

        <div class="tw-dir-picker__footer">
          <Button label="Cancel" variant="secondary" onClick={() => props.onCancel()} />
          <Button label="Use this folder" variant="primary" icon={<CheckIcon />} disabled={!canConfirm()} onClick={confirm} />
        </div>
      </div>
    </div>
  );
}
