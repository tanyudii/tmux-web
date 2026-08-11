// Ports kmp/.../ui/projects/NewProjectSheet.kt. `name` is a free-text field;
// `repoPath` is picked via DirectoryPickerDialog (ui/web/RepoPathPicker.kt +
// TmuxDirectoryPickerDialog.kt, 18a) rather than typed -- the value is
// always an absolute path on the *server*'s filesystem, not something worth
// typing by hand (see GET /api/browse). Form fields are local component
// state, not store state, same split as the Kotlin original.
import { createSignal, Show } from "solid-js";
import { Sheet, TextField } from "../ui";
import { DirectoryPickerDialog } from "./DirectoryPickerDialog";
import { createDirectoryPickerStore, type DirectoryPickerStore } from "../stores/directoryPickerStore";
import type { ApiClient } from "../api/client";
import type { NewProjectState } from "../stores/projectListStore";

export interface NewProjectSheetProps {
  state: NewProjectState;
  api: Pick<ApiClient, "browseDirectory">;
  onSave: (name: string, repoPath: string) => void;
  onCancel: () => void;
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

// Visually the same frame as TextField (label, bgRaised field, border), but
// tapping it opens the DirectoryPickerDialog instead of a keyboard.
function RepoPathField(props: { repoPath: string; onClick: () => void }) {
  return (
    <div class="tw-textfield">
      <label class="tw-textfield__label">Repo path</label>
      <button type="button" class="tw-textfield__row tw-repo-path-field" onClick={() => props.onClick()}>
        <span class="tw-textfield__icon" aria-hidden="true">
          <FolderIcon />
        </span>
        <span classList={{ "tw-repo-path-field__placeholder": props.repoPath === "" }}>
          {props.repoPath || "Choose a folder…"}
        </span>
      </button>
    </div>
  );
}

export function NewProjectSheet(props: NewProjectSheetProps) {
  const [name, setName] = createSignal("");
  const [repoPath, setRepoPath] = createSignal("");
  // Holds the actual store (not a boolean/token) so it's created
  // *imperatively* in openPicker() -- fresh each open, matching the Kotlin
  // original's `remember { DirectoryPickerViewModel(...) }` scoped to one
  // picker composition. Creating it inline inside <Show>'s callback
  // children instead (i.e. `<Show when={open()}>{() =>
  // <DirectoryPickerDialog store={createDirectoryPickerStore(...)} />}`)
  // was tried first and looked fine in code review, but broke live: the
  // store's setState updates stopped reaching the rendered DOM (button
  // stayed stuck on its initial `disabled` value forever) -- reproduced
  // with a minimal repro outside this file, not guessed. Store creation
  // needs to happen outside Show's memoized callback scope.
  const [pickerStore, setPickerStore] = createSignal<DirectoryPickerStore | null>(null);

  const canSave = () => name().trim() !== "" && !props.state.isSaving;

  function openPicker(): void {
    setPickerStore(createDirectoryPickerStore({ api: props.api }));
  }

  function closePicker(): void {
    setPickerStore(null);
  }

  return (
    <>
      <Sheet
        title="New Project"
        actionLabel="Add"
        actionEnabled={canSave()}
        onDismiss={props.onCancel}
        onAction={() => props.onSave(name().trim(), repoPath().trim())}
      >
        <TextField label="Name" value={name()} onValueChange={setName} placeholder="my-app" disabled={props.state.isSaving} />
        <RepoPathField repoPath={repoPath()} onClick={openPicker} />
        <Show when={props.state.errorMessage}>
          <p class="tw-sheet__error">{props.state.errorMessage}</p>
        </Show>
      </Sheet>
      <Show when={pickerStore()}>
        {(store) => (
          <DirectoryPickerDialog
            store={store()}
            onPicked={(path) => {
              setRepoPath(path);
              closePicker();
            }}
            onCancel={closePicker}
          />
        )}
      </Show>
    </>
  );
}
