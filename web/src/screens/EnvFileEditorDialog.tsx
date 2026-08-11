// Ports kmp/.../ui/components/TmuxEnvFileEditorDialog.kt -- editor for a
// session's `.tmux-web-env/` files (docker-compose.yml, pre-run.sh,
// post-run.sh, env.json), EMB-210. Saving never restarts a running
// environment; the caller must explicitly re-run Setup for a change to
// take effect, same as editing these files by hand always did. Triggered
// from the Environment menu's "Edit config" icon (task #18e) -- built and
// tested standalone here since #18e doesn't exist yet.
import { For, Show, onMount } from "solid-js";
import { Button, IconButton } from "../ui";
import type { EnvFileEditorStore } from "../stores/envFileEditorStore";

export interface EnvFileEditorDialogProps {
  store: EnvFileEditorStore;
  onDismiss: () => void;
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}

export function EnvFileEditorDialog(props: EnvFileEditorDialogProps) {
  onMount(() => void props.store.start());

  const state = () => props.store.state;

  return (
    <div class="tw-sheet-scrim" onClick={() => props.onDismiss()}>
      <div class="tw-env-editor" onClick={(event) => event.stopPropagation()}>
        <div class="tw-env-editor__header">
          <IconButton icon={<CloseIcon />} label="Close editor" size="sm" onClick={() => props.onDismiss()} />
          <span class="tw-env-editor__title">.tmux-web-env</span>
        </div>

        <Show when={state().files.length > 0}>
          <div class="tw-env-editor__tabs">
            <For each={state().files}>
              {(file) => (
                <button
                  type="button"
                  class="tw-env-editor__tab"
                  classList={{ "tw-env-editor__tab--active": file.filename === state().selectedFilename }}
                  onClick={() => void props.store.selectFile(file.filename)}
                >
                  {file.filename}
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show when={state().errorMessage}>
          <p class="tw-env-editor__banner tw-env-editor__banner--error">{state().errorMessage}</p>
        </Show>
        <Show when={state().savedFilename}>
          {(filename) => (
            <p class="tw-env-editor__banner tw-env-editor__banner--saved">
              Saved {filename()}. Re-run Setup for the running environment to pick up the change.
            </p>
          )}
        </Show>

        <div class="tw-env-editor__body">
          <Show
            when={!state().isLoading && state().files.length > 0}
            fallback={
              <div class="tw-env-editor__hint">
                {state().isLoading ? "Loading…" : "No .tmux-web-env/ files for this session."}
              </div>
            }
          >
            <textarea
              class="tw-env-editor__textarea"
              spellcheck={false}
              value={state().draftContent}
              onInput={(event) => props.store.updateDraft(event.currentTarget.value)}
            />
          </Show>
        </div>

        <div class="tw-env-editor__footer">
          <Button
            label="Save"
            variant="primary"
            loading={state().isSaving}
            disabled={state().selectedFilename === null || state().isSaving}
            onClick={() => void props.store.save()}
          />
        </div>
      </div>
    </div>
  );
}
