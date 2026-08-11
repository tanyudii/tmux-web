// Ports kmp/.../ui/web/ChangesRail.kt + presentation/ChangesTree.kt's
// row-flattening (expressed here as a recursive Solid component instead
// of a pre-flattened row list -- Solid's <For>/<Show> doesn't need a flat
// list the way a Compose LazyColumn benefits from one). Extracted out of
// ChangesDialog.tsx (mobile) so both the mobile full-screen dialog and
// the desktop persistent rail (WebMainPane.tsx) render the exact same
// tree/commit UI against the exact same ChangesStore -- mirroring the
// Kotlin original, where `ChangesDialog` wraps this same `ChangesRail`
// composable in a full-screen `Dialog` rather than duplicating it.
import { For, Show, createSignal } from "solid-js";
import { Button, ConfirmDialog, ErrorBanner, IconButton, NavBar, TextField } from "../ui";
import { buildFileTree, type FileTreeNode } from "../domain/fileTree";
import type { ChangedFile, DiffMode } from "../api/types";
import type { ChangesStore } from "../stores/changesStore";
import { DiffView } from "./DiffView";

export interface ChangesRailProps {
  store: ChangesStore;
  class?: string;
}

const STATUS_MARKER: Record<ChangedFile["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 7h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3.5 4h7M6 4V3a.7.7 0 01.7-.7h.6a.7.7 0 01.7.7v1M4.5 4v6.5a.8.8 0 00.8.8h3.4a.8.8 0 00.8-.8V4"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M1.5 3.5a.8.8 0 01.8-.8h2.8l1 1H11.7a.8.8 0 01.8.8v6.2a.8.8 0 01-.8.8h-9a.8.8 0 01-.8-.8V3.5z"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function FileRow(props: {
  file: ChangedFile;
  depth: number;
  onOpen: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
}) {
  return (
    <div class="tw-changes-row" style={{ "padding-left": `${props.depth * 14 + 10}px` }}>
      <button type="button" class="tw-changes-row__name" onClick={props.onOpen}>
        <span class="tw-changes-row__marker" data-conflicted={props.file.conflicted ? "true" : undefined}>
          {props.file.conflicted ? "!" : STATUS_MARKER[props.file.status]}
        </span>
        <span class="tw-changes-row__path">{props.file.path}</span>
      </button>
      <span class="tw-changes-row__actions">
        <Show
          when={props.file.staged}
          fallback={<IconButton icon={<PlusIcon />} label={`Stage ${props.file.path}`} size="sm" onClick={props.onStage} />}
        >
          <IconButton icon={<MinusIcon />} label={`Unstage ${props.file.path}`} size="sm" onClick={props.onUnstage} />
        </Show>
        <IconButton icon={<TrashIcon />} label={`Discard ${props.file.path}`} size="sm" variant="danger" onClick={props.onDiscard} />
      </span>
    </div>
  );
}

function TreeNodeRows(props: {
  nodes: FileTreeNode[];
  depth: number;
  collapsed: string[];
  onToggleCollapse: (id: string) => void;
  onOpenFile: (file: ChangedFile) => void;
  onStage: (file: ChangedFile) => void;
  onUnstage: (file: ChangedFile) => void;
  onDiscard: (file: ChangedFile) => void;
}) {
  return (
    <For each={props.nodes}>
      {(node) => (
        <Show
          when={node.isFolder}
          fallback={
            <FileRow
              file={node.file as ChangedFile}
              depth={props.depth}
              onOpen={() => props.onOpenFile(node.file as ChangedFile)}
              onStage={() => props.onStage(node.file as ChangedFile)}
              onUnstage={() => props.onUnstage(node.file as ChangedFile)}
              onDiscard={() => props.onDiscard(node.file as ChangedFile)}
            />
          }
        >
          <button
            type="button"
            class="tw-changes-row tw-changes-row--folder"
            style={{ "padding-left": `${props.depth * 14 + 10}px` }}
            onClick={() => props.onToggleCollapse(node.id)}
          >
            <FolderIcon />
            <span class="tw-changes-row__path">{node.name}</span>
          </button>
          <Show when={!props.collapsed.includes(node.id)}>
            <TreeNodeRows {...props} nodes={node.children} depth={props.depth + 1} />
          </Show>
        </Show>
      )}
    </For>
  );
}

function ChangesSection(props: {
  title: string;
  files: ChangedFile[];
  mode: DiffMode;
  collapsed: string[];
  onToggleCollapse: (id: string) => void;
  onOpenFile: (file: ChangedFile, mode: DiffMode) => void;
  onStage: (file: ChangedFile) => void;
  onUnstage: (file: ChangedFile) => void;
  onDiscard: (file: ChangedFile, mode: DiffMode) => void;
}) {
  return (
    <Show when={props.files.length > 0}>
      <div class="tw-changes-section">
        <p class="tw-changes-section__title">
          {props.title} ({props.files.length})
        </p>
        <TreeNodeRows
          nodes={buildFileTree(props.files)}
          depth={0}
          collapsed={props.collapsed}
          onToggleCollapse={props.onToggleCollapse}
          onOpenFile={(file) => props.onOpenFile(file, props.mode)}
          onStage={props.onStage}
          onUnstage={props.onUnstage}
          onDiscard={(file) => props.onDiscard(file, props.mode)}
        />
      </div>
    </Show>
  );
}

export function ChangesRail(props: ChangesRailProps) {
  const { store } = props;
  const [collapsed, setCollapsed] = createSignal<string[]>([]);

  function toggleCollapse(id: string): void {
    setCollapsed((current) => (current.includes(id) ? current.filter((c) => c !== id) : [...current, id]));
  }

  const changes = () => store.state.changes;

  return (
    <div class={`tw-changes-rail ${props.class ?? ""}`}>
      <Show when={store.state.errorMessage}>
        <ErrorBanner message={store.state.errorMessage ?? ""} onDismiss={store.dismissError} />
      </Show>
      <Show when={changes()?.repoState !== "clean"}>
        <div class="tw-changes-dialog__repo-state">Repository is {changes()?.repoState}.</div>
      </Show>
      <div class="tw-screen__scroll">
        <Show when={changes()}>
          {(c) => (
            <>
              <ChangesSection
                title="Staged"
                files={c().staged}
                mode="staged"
                collapsed={collapsed()}
                onToggleCollapse={toggleCollapse}
                onOpenFile={(file, mode) => void store.openDiffFor(file, mode)}
                onStage={(file) => void store.stage(file)}
                onUnstage={(file) => void store.unstage(file)}
                onDiscard={(file, mode) => store.requestDiscard(file, mode)}
              />
              <ChangesSection
                title="Changes"
                files={c().unstaged}
                mode="unstaged"
                collapsed={collapsed()}
                onToggleCollapse={toggleCollapse}
                onOpenFile={(file, mode) => void store.openDiffFor(file, mode)}
                onStage={(file) => void store.stage(file)}
                onUnstage={(file) => void store.unstage(file)}
                onDiscard={(file, mode) => store.requestDiscard(file, mode)}
              />
              <ChangesSection
                title="Conflicted"
                files={c().conflicted}
                mode="unstaged"
                collapsed={collapsed()}
                onToggleCollapse={toggleCollapse}
                onOpenFile={(file, mode) => void store.openDiffFor(file, mode)}
                onStage={(file) => void store.stage(file)}
                onUnstage={(file) => void store.unstage(file)}
                onDiscard={(file, mode) => store.requestDiscard(file, mode)}
              />
              <ChangesSection
                title="Untracked"
                files={c().untracked}
                mode="untracked"
                collapsed={collapsed()}
                onToggleCollapse={toggleCollapse}
                onOpenFile={(file, mode) => void store.openDiffFor(file, mode)}
                onStage={(file) => void store.stage(file)}
                onUnstage={(file) => void store.unstage(file)}
                onDiscard={(file, mode) => store.requestDiscard(file, mode)}
              />
            </>
          )}
        </Show>
      </div>
      <div class="tw-changes-dialog__commit">
        <TextField
          value={store.state.commitMessage}
          onValueChange={store.updateCommitMessage}
          placeholder="Commit message"
          disabled={store.state.isCommitting}
        />
        <Button
          label="Commit"
          disabled={store.state.commitMessage.trim() === "" || store.state.isCommitting || (changes()?.staged.length ?? 0) === 0}
          loading={store.state.isCommitting}
          onClick={() => void store.commit()}
        />
      </div>

      <Show when={store.state.pendingDiscard}>
        {(pending) => (
          <ConfirmDialog
            title="Discard changes"
            message={`Discard changes to ${pending().file.path}? This can't be undone.`}
            confirmLabel="Discard"
            onConfirm={() => store.confirmDiscard()}
            onCancel={store.cancelDiscard}
          />
        )}
      </Show>
    </div>
  );
}

/** The per-file diff view overlay -- shared by the mobile dialog and the web shell rail. */
export function DiffOverlay(props: { store: ChangesStore; backLabel: string }) {
  const { store } = props;
  return (
    <Show when={store.state.openDiff}>
      {(diff) => (
        <div class="tw-diff-overlay">
          <NavBar title={diff().file.path} back={{ label: props.backLabel, onClick: store.closeDiff }} />
          <div class="tw-screen__scroll">
            <Show when={diff().isBinary}>
              <p class="tw-diff-overlay__notice">Binary file not shown.</p>
            </Show>
            <Show when={diff().errorMessage}>
              <p class="tw-diff-overlay__notice">{diff().errorMessage}</p>
            </Show>
            <Show when={diff().parsedDiff}>{(parsed) => <DiffView parsedDiff={parsed()} />}</Show>
          </div>
        </div>
      )}
    </Show>
  );
}
