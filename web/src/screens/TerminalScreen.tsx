// Ports kmp/.../ui/terminal/TerminalScreen.kt + TerminalSession.kt,
// composing Phase 4's TerminalView (xterm.js binding) with
// stores/terminalStore.ts (socket lifecycle/reconnect/bell) and
// stores/changesStore.ts (git changes, polled for the whole lifetime of
// this screen -- not just while the dialog is open -- so the Changes nav
// button's badge count stays live even before the user opens it, matching
// the Kotlin original's `ChangesNavButton` badge behavior).
//
// task #18e ports TmuxEnvironmentMenu (docker-compose run/stop/logs), the
// stop-environment confirm dialog, and the logs dialog here too -- one
// deliberate divergence from the Kotlin original: TerminalScreen.kt's own
// TmuxEnvironmentMenu call never wires `onEditConfig` (mobile has no way to
// open the env-file editor at all, silently), which is a dead "Edit config"
// icon rather than a real design choice. Wiring it here instead reuses the
// same EnvFileEditorDialog already built for desktop (18c) at near-zero
// extra cost and avoids shipping a button that does nothing.
//
// task #18f wires PushNotificationToggle here too -- Kotlin's
// TopBar-only call site (WebMainPane.kt) never renders it on mobile at all.
// Unlike environment/logs, the push store itself is NOT created per screen
// mount here (see pushStore.ts's header comment: a subscription belongs to
// the browser, not a session) -- App.tsx creates one instance for the whole
// connected app and threads it down as `props.pushStore`.
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { ConfirmDialog, ConnectionBanner, ErrorBanner, IconButton, NavBar } from "../ui";
import { TerminalView, type TerminalHandle } from "../terminal/TerminalView";
import type { FitAddonLike, SearchAddonLike, TerminalLike } from "../terminal/types";
import { createTerminalStore } from "../stores/terminalStore";
import { createChangesStore } from "../stores/changesStore";
import { createEnvironmentStore } from "../stores/environmentStore";
import { createEnvFileEditorStore, type EnvFileEditorStore } from "../stores/envFileEditorStore";
import { createLogsStore, type LogsStore } from "../stores/logsStore";
import { createTerminalSocket, type TerminalSocket } from "../api/terminalSocket";
import { createLogsSocket, type LogsSocket } from "../api/logsSocket";
import type { ApiClient } from "../api/client";
import type { PushStore } from "../stores/pushStore";
import { ChangesDialog } from "./ChangesDialog";
import { EnvFileEditorDialog } from "./EnvFileEditorDialog";
import { EnvironmentMenu } from "./EnvironmentMenu";
import { LogsDialog } from "./LogsDialog";
import { PasteSheet } from "./PasteSheet";
import { PushNotificationToggle } from "./PushNotificationToggle";
import { QuickKeysBar } from "./QuickKeysBar";

export interface TerminalScreenProps {
  api: ApiClient;
  baseUrl: string;
  token: string;
  projectId: string;
  sessionFullName: string;
  sessionName: string;
  projectName: string;
  onBack: () => void;
  pushStore: PushStore;
  createSocket?: (config: { baseUrl: string; token: string }) => TerminalSocket;
  createLogsSocket?: (config: { baseUrl: string; token: string }) => LogsSocket;
  // Forwarded straight to TerminalView -- real @xterm/xterm cannot run
  // under jsdom (see terminal/TerminalView.tsx's header comment), so tests
  // exercising this screen's own composition logic (badge count,
  // connection banner, changes dialog, back nav) inject fakes here instead
  // of mounting real xterm.
  createTerminal?: () => TerminalLike;
  createFitAddon?: () => FitAddonLike;
  createSearchAddon?: () => SearchAddonLike;
}

function sessionLabelFromFullName(fullName: string): string | null {
  const separatorIndex = fullName.indexOf("__");
  return separatorIndex === -1 ? null : fullName.slice(separatorIndex + 2);
}

function ChangesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M4 3v8.5a2 2 0 002 2h6M4 3H2.5M4 3h2M14 15V6.5a2 2 0 00-2-2H6"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function TerminalScreen(props: TerminalScreenProps) {
  const createSocket = props.createSocket ?? createTerminalSocket;
  const socket = createSocket({ baseUrl: props.baseUrl, token: props.token });
  const terminal = createTerminalStore({
    socket,
    sessionFullName: props.sessionFullName,
    sessionLabel: sessionLabelFromFullName(props.sessionFullName),
  });
  const changes = createChangesStore({ projectId: props.projectId, sessionSlug: props.sessionName, api: props.api });
  changes.start();
  const environment = createEnvironmentStore({ projectId: props.projectId, sessionSlug: props.sessionName, api: props.api });
  environment.start();

  const [isChangesOpen, setChangesOpen] = createSignal(false);
  const [environmentMenuOpen, setEnvironmentMenuOpen] = createSignal(false);
  const [isSelecting, setSelecting] = createSignal(false);
  const [isArrowMode, setArrowMode] = createSignal(false);
  const [isCtrlMode, setCtrlMode] = createSignal(false);
  const [isPasteOpen, setPasteOpen] = createSignal(false);
  // TerminalView hands this over on mount; it is the only route to xterm's
  // own paste()/selection APIs from up here.
  const [terminalHandle, setTerminalHandle] = createSignal<TerminalHandle | null>(null);
  const [envEditorStore, setEnvEditorStore] = createSignal<EnvFileEditorStore | null>(null);
  const [logsStore, setLogsStore] = createSignal<LogsStore | null>(null);

  function ensureLogsStore(): LogsStore {
    const existing = logsStore();
    if (existing) return existing;
    const socket = (props.createLogsSocket ?? createLogsSocket)({ baseUrl: props.baseUrl, token: props.token });
    const created = createLogsStore({ projectId: props.projectId, sessionSlug: props.sessionName, socket });
    setLogsStore(created);
    return created;
  }

  function handleViewLogs(service: string): void {
    ensureLogsStore();
    environment.showLogs(service);
  }

  // Leaving selection mode drops any leftover highlight, so the terminal
  // does not come back with a stale-looking selection painted over live
  // output the next time tmux repaints under it.
  function handleToggleSelecting(next: boolean): void {
    setSelecting(next);
    // The modes compete for the same row and for the same touch gesture,
    // so entering one leaves the others.
    if (next) {
      setArrowMode(false);
      setCtrlMode(false);
    }
    if (!next) terminalHandle()?.clearSelection();
  }

  // Entering arrow mode also drops any live selection: selection mode hands
  // the drag to the browser, and leaving a highlight painted over the pane
  // while the user starts navigating a menu just looks like a stuck artifact.
  function handleToggleArrows(next: boolean): void {
    setArrowMode(next);
    if (next) {
      setCtrlMode(false);
      if (isSelecting()) handleToggleSelecting(false);
    }
  }

  // Entering ctrl mode leaves the other two modes for the same reason they
  // leave each other: one row, one mode. Unlike selection mode there is no
  // highlight to drop, so this is purely the flag dance.
  function handleToggleCtrl(next: boolean): void {
    setCtrlMode(next);
    if (next) {
      setArrowMode(false);
      if (isSelecting()) handleToggleSelecting(false);
    }
  }

  function handleEditConfig(): void {
    setEnvEditorStore(createEnvFileEditorStore({ projectId: props.projectId, sessionSlug: props.sessionName, api: props.api }));
  }

  onCleanup(() => {
    terminal.dispose();
    changes.stop();
    environment.dispose();
    logsStore()?.close();
  });

  const badgeCount = createMemo(() => {
    const c = changes.state.changes;
    if (!c) return 0;
    return c.staged.length + c.unstaged.length + c.untracked.length;
  });

  // Any Popup opened from this screen (environment dropdown, stop confirm,
  // edit-config/logs dialogs, the Changes dialog) must hide the terminal's
  // native xterm.js DOM element for its duration -- TerminalView.tsx's
  // `isVisible` kdoc, same click-swallowing bug class CLAUDE.md flags.
  const terminalVisible = () =>
    !isChangesOpen() &&
    !isPasteOpen() &&
    !environmentMenuOpen() &&
    !environment.state.isShowingStopConfirm &&
    envEditorStore() === null &&
    environment.state.logsService === null;

  return (
    <div class="tw-terminal-screen">
      <NavBar
        title={props.sessionName}
        back={{ label: props.projectName, onClick: props.onBack }}
        right={
          <span class="tw-terminal-badge">
            <IconButton icon={<ChangesIcon />} label="View changes" onClick={() => setChangesOpen(true)} />
            <Show when={badgeCount() > 0}>
              <span class="tw-terminal-badge__count">{badgeCount()}</span>
            </Show>
            <EnvironmentMenu
              status={environment.state.status}
              isBusy={environment.state.isBusy}
              onRun={() => void environment.setup()}
              onStop={() => environment.requestStop()}
              onReload={(rebuild, service) => void environment.reload(rebuild, service)}
              onCancel={() => void environment.cancel()}
              onEditConfig={handleEditConfig}
              onViewLogs={handleViewLogs}
              onOpenChanged={setEnvironmentMenuOpen}
            />
            <PushNotificationToggle store={props.pushStore} />
          </span>
        }
      />
      <Show when={terminal.state.phase !== "connected"}>
        <ConnectionBanner
          // "ended" maps straight through: it is not a connectivity problem, so
          // it must not be flattened into "disconnected" with a Retry that can
          // only ever fail against a session tmux has already destroyed.
          status={
            terminal.state.phase === "reconnecting"
              ? "reconnecting"
              : terminal.state.phase === "ended"
                ? "ended"
                : "disconnected"
          }
          onRetry={terminal.retry}
          onLeave={props.onBack}
          leaveLabel="Back to sessions"
        />
      </Show>
      <Show when={props.pushStore.state.errorMessage}>
        {(message) => <ErrorBanner message={message()} onDismiss={props.pushStore.dismissError} />}
      </Show>
      <div class="tw-terminal-screen__view">
        <TerminalView
          onInput={terminal.onInput}
          onBell={terminal.onBell}
          onResize={terminal.onResize}
          onReady={(handle) => {
            setTerminalHandle(() => handle);
            terminal.onReady(handle);
          }}
          isVisible={terminalVisible()}
          isSelecting={isSelecting()}
          onScroll={terminal.onScroll}
          createTerminal={props.createTerminal}
          createFitAddon={props.createFitAddon}
          createSearchAddon={props.createSearchAddon}
        />
      </div>
      <QuickKeysBar
        onKeyTap={terminal.onInput}
        isSelecting={isSelecting()}
        onToggleSelecting={handleToggleSelecting}
        onCopy={() => void terminalHandle()?.copySelection()}
        onClearSelection={() => terminalHandle()?.clearSelection()}
        onPaste={() => setPasteOpen(true)}
        isArrowMode={isArrowMode()}
        onToggleArrows={handleToggleArrows}
        onPressKey={(name) => terminalHandle()?.pressKey(name)}
        isCtrlMode={isCtrlMode()}
        onToggleCtrl={handleToggleCtrl}
      />

      <Show when={isPasteOpen()}>
        <PasteSheet onSend={(text) => terminalHandle()?.paste(text)} onDismiss={() => setPasteOpen(false)} />
      </Show>

      <Show when={isChangesOpen()}>
        <ChangesDialog store={changes} onClose={() => setChangesOpen(false)} />
      </Show>
      <Show when={envEditorStore()}>
        {(store) => <EnvFileEditorDialog store={store()} onDismiss={() => setEnvEditorStore(null)} />}
      </Show>
      <Show when={environment.state.logsService}>
        {(service) => (
          <LogsDialog
            selectedService={service()}
            services={environment.state.status?.services ?? []}
            store={logsStore() as LogsStore}
            onDismiss={() => environment.hideLogs()}
            onSwitchService={(next) => environment.switchLogsService(next)}
          />
        )}
      </Show>
      <Show when={environment.state.isShowingStopConfirm}>
        <ConfirmDialog
          title="Stop environment?"
          message="All running services will be stopped."
          confirmLabel="Stop"
          onConfirm={() => environment.stop()}
          onCancel={() => environment.cancelStop()}
        />
      </Show>
    </div>
  );
}
