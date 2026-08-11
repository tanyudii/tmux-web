// Ports kmp/.../ui/web/WebShellScreen.kt -- the desktop (>=900px) root
// layout: sidebar + main pane, plus the New Project/New Session/delete
// dialogs. Reuses NewProjectSheet.tsx/NewSessionSheet.tsx as-is (Phase 6)
// -- webShellStore's dialog state shapes are structurally identical to
// projectListStore's/sessionListStore's, so no duplicate sheet needed.
//
// Access-log dialog and resource-usage/environment-menu chrome in the top
// bar live in WebSidebar.tsx / WebMainPane.tsx respectively.
//
// #18g wires the Ctrl+K/Cmd+K command palette (EMB-218) here too, as a
// window-level keydown listener -- the direct TS equivalent of Kotlin's
// Modifier.commandPaletteShortcut (see TmuxCommandPalette.kt's doc
// comment). One real-DOM difference from the Compose original matters: in
// Kotlin, xterm.js lives in a native interop view entirely outside
// Compose's focus/event tree, so a Compose-level onPreviewKeyEvent simply
// never sees a keydown that originated there -- no guard needed. Here
// everything is real DOM, so a window-level keydown listener WOULD also
// see keystrokes typed into the terminal, including Ctrl+K, which is a
// real shell keystroke (readline's kill-to-end-of-line) that must reach
// xterm untouched. handleWindowKeyDown below explicitly skips opening the
// palette when the event originated inside any terminal container --
// `.tw-web-main-pane__terminal` (desktop shell) or
// `.tw-terminal-screen__view` (mobile screen) -- to reproduce that same
// "never fires while a terminal has focus" behavior by construction rather
// than by accident of a separate view tree.
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { ConfirmDialog, ErrorBanner } from "../ui";
import type { ApiClient } from "../api/client";
import type { CommandPaletteItem } from "../domain/commandPalette";
import type { PushStore } from "../stores/pushStore";
import type { PendingDeleteSession, WebShellStore } from "../stores/webShellStore";
import { CommandPalette } from "./CommandPalette";
import { NewProjectSheet } from "./NewProjectSheet";
import { NewSessionSheet } from "./NewSessionSheet";
import { WebMainPane } from "./WebMainPane";
import { WebSidebar } from "./WebSidebar";

const TERMINAL_CONTAINER_SELECTOR = ".tw-web-main-pane__terminal, .tw-terminal-screen__view";

function isCommandPaletteShortcut(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey);
}

function SessionDeleteDialog(props: { pending: PendingDeleteSession; store: WebShellStore }) {
  const { pending, store } = props;

  return (
    <ConfirmDialog
      title="Delete session"
      message={pending.message ?? "Delete this session? This can't be undone."}
      force={pending.forced}
      onConfirm={() => store.confirmPendingDelete()}
      onCancel={store.cancelPendingDelete}
    >
      <label class="tw-delete-branch-option">
        <input
          type="checkbox"
          checked={pending.deleteBranch}
          onChange={(event) => void store.setDeleteBranchOnSessionDelete(event.currentTarget.checked)}
        />
        Delete branch too
      </label>
      <Show when={pending.deleteBranch && pending.branchMergeChecked && pending.branchMerged === false}>
        <p class="tw-delete-branch-warning">
          This branch has unmerged commits.
          <Show when={!pending.unmergedConfirmed}> Tap Force delete again to confirm.</Show>
        </p>
      </Show>
    </ConfirmDialog>
  );
}

export interface WebShellScreenProps {
  store: WebShellStore;
  api: ApiClient;
  baseUrl: string;
  token: string;
  serverHost: string;
  onSwitchServer: () => void;
  pushStore: PushStore;
}

export function WebShellScreen(props: WebShellScreenProps) {
  const { store } = props;
  const [paletteOpen, setPaletteOpen] = createSignal(false);

  function handleWindowKeyDown(event: KeyboardEvent): void {
    if (!isCommandPaletteShortcut(event)) return;
    const target = event.target;
    if (target instanceof Element && target.closest(TERMINAL_CONTAINER_SELECTOR)) return;
    // Compose's Dialog() traps focus at the platform level, so the Kotlin
    // original's background onPreviewKeyEvent simply never fires while a
    // sheet/confirm dialog is open -- a real-DOM window listener has no
    // such trap and would otherwise stack the palette on top of an
    // already-open dialog (and steal its focus) without this check.
    if (store.hasOpenDialog()) return;
    event.preventDefault();
    store.loadAllSessions();
    setPaletteOpen(true);
  }

  onMount(() => {
    window.addEventListener("keydown", handleWindowKeyDown);
  });
  onCleanup(() => {
    window.removeEventListener("keydown", handleWindowKeyDown);
  });

  function handlePaletteSelect(item: CommandPaletteItem): void {
    if (item.kind === "project") {
      store.selectProject(item.projectId);
    } else {
      store.selectSession(item.projectId, item.sessionName);
    }
    setPaletteOpen(false);
  }

  return (
    <div class="tw-web-shell">
      <WebSidebar store={store} api={props.api} serverHost={props.serverHost} onSwitchServer={props.onSwitchServer} />
      <WebMainPane
        api={props.api}
        baseUrl={props.baseUrl}
        token={props.token}
        project={store.selectedProject()}
        session={store.selectedSession()}
        projectId={store.state.selectedProjectId}
        onNewSession={() => {
          if (store.state.selectedProjectId) store.showNewSessionDialog(store.state.selectedProjectId);
        }}
        onSessionEnded={store.clearSelectedSession}
        pushStore={props.pushStore}
      />

      <Show when={store.state.errorMessage}>
        <ErrorBanner message={store.state.errorMessage ?? ""} onDismiss={store.dismissError} />
      </Show>

      <Show when={store.state.newProjectDialog}>
        {(dialogState) => (
          <NewProjectSheet
            state={dialogState()}
            api={props.api}
            onSave={(name, repoPath) => void store.createProject(name, repoPath)}
            onCancel={store.cancelNewProjectDialog}
          />
        )}
      </Show>

      <Show when={store.state.newSessionDialog}>
        {(dialogState) => (
          <NewSessionSheet
            creationState={dialogState()}
            templates={dialogState().templates}
            onCreate={(name, startupCommand) => void store.createSession(name, startupCommand)}
            onSaveAsTemplate={(name, startupCommand) => void store.saveAsTemplate(name, startupCommand)}
            onDeleteTemplate={(templateId) => void store.deleteTemplate(templateId)}
            onCancel={store.cancelNewSessionDialog}
          />
        )}
      </Show>

      <Show when={store.state.pendingDelete}>
        {(pending) => {
          const value = pending();
          if (value.kind === "session") return <SessionDeleteDialog pending={value} store={store} />;
          return (
            <ConfirmDialog
              title="Delete project"
              message={value.message ?? "Delete this project? This can't be undone."}
              force={value.forced}
              onConfirm={() => store.confirmPendingDelete()}
              onCancel={store.cancelPendingDelete}
            />
          );
        }}
      </Show>

      <Show when={paletteOpen()}>
        <CommandPalette
          projects={store.state.projects}
          sessionsByProjectId={store.state.sessionsByProjectId}
          onSelect={handlePaletteSelect}
          onDismiss={() => setPaletteOpen(false)}
        />
      </Show>
    </div>
  );
}
