// Ports kmp/.../ui/web/WebMainPane.kt. Terminal-hosting plumbing
// (terminalStore + TerminalView) is genuinely shared with the mobile
// TerminalScreen.tsx at the *store/component* level (both just construct
// createTerminalStore + <TerminalView>), matching Kotlin's own
// `rememberTerminalSession` reuse -- but the surrounding layout
// (breadcrumb top bar, WindowTabs, no QuickKeysBar, persistent
// ChangesRail instead of a toggleable full-screen dialog) is intentionally
// separate, same split as the Kotlin original (§8 of the Phase 7 research
// pass: shared session wiring, separate screen composables).
import { createSignal, onCleanup, Show } from "solid-js";
import { Button, ConfirmDialog, ConnectionBanner, ErrorBanner, IconButton } from "../ui";
import { TerminalView } from "../terminal/TerminalView";
import type { FitAddonLike, SearchAddonLike, TerminalLike } from "../terminal/types";
import { createTerminalStore } from "../stores/terminalStore";
import { createChangesStore } from "../stores/changesStore";
import { createEnvironmentStore } from "../stores/environmentStore";
import { createEnvFileEditorStore, type EnvFileEditorStore } from "../stores/envFileEditorStore";
import { createLogsStore, type LogsStore } from "../stores/logsStore";
import { createSessionResourceUsageStore } from "../stores/sessionResourceUsageStore";
import { formatResourceUsageBadge } from "../domain/resourceUsageFormat";
import { createTerminalSocket, type TerminalSocket } from "../api/terminalSocket";
import { createLogsSocket, type LogsSocket } from "../api/logsSocket";
import type { ApiClient } from "../api/client";
import type { Project, ProjectSession } from "../api/types";
import type { PushStore } from "../stores/pushStore";
import { ChangesRail, DiffOverlay } from "./ChangesRail";
import { EnvFileEditorDialog } from "./EnvFileEditorDialog";
import { EnvironmentMenu } from "./EnvironmentMenu";
import { LogsDialog } from "./LogsDialog";
import { PushNotificationToggle } from "./PushNotificationToggle";
import { WindowTabs } from "./WindowTabs";

export interface WebMainPaneProps {
  api: ApiClient;
  baseUrl: string;
  token: string;
  project: Project | null;
  session: ProjectSession | null;
  projectId: string | null;
  onNewSession: () => void;
  /** Called when the session's tmux session ends, so the shell can deselect it. */
  onSessionEnded: () => void;
  pushStore: PushStore;
  createSocket?: (config: { baseUrl: string; token: string }) => TerminalSocket;
  createLogsSocket?: (config: { baseUrl: string; token: string }) => LogsSocket;
  createTerminal?: () => TerminalLike;
  createFitAddon?: () => FitAddonLike;
  createSearchAddon?: () => SearchAddonLike;
}

function TerminalIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="26" height="22" rx="3" stroke="currentColor" stroke-width="1.5" />
      <path d="M9 13l5 4-5 4M17 21h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
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

function sessionLabelFromFullName(fullName: string): string | null {
  const separatorIndex = fullName.indexOf("__");
  return separatorIndex === -1 ? null : fullName.slice(separatorIndex + 2);
}

/** Everything that needs to be torn down/recreated when the selected session changes. */
function SessionPane(props: WebMainPaneProps & { project: Project; session: ProjectSession; projectId: string }) {
  const createSocket = props.createSocket ?? createTerminalSocket;
  const socket = createSocket({ baseUrl: props.baseUrl, token: props.token });
  const terminal = createTerminalStore({
    socket,
    sessionFullName: props.session.fullName,
    sessionLabel: sessionLabelFromFullName(props.session.fullName),
  });
  const changes = createChangesStore({ projectId: props.projectId, sessionSlug: props.session.name, api: props.api });
  changes.start();
  const resourceUsage = createSessionResourceUsageStore({
    projectId: props.projectId,
    sessionSlug: props.session.name,
    api: props.api,
  });
  resourceUsage.start();
  const environment = createEnvironmentStore({ projectId: props.projectId, sessionSlug: props.session.name, api: props.api });
  environment.start();

  // Closed by default. It used to open with every session, so landing on a
  // session -- especially straight after creating one -- meant the git changes
  // panel took a third of the pane before you had typed anything, on a screen
  // whose whole point is the terminal. The "Toggle changes" button in the top
  // bar is the way in, and the nav badge already shows the change count, so
  // nothing is hidden by defaulting this off.
  const [railOpen, setRailOpen] = createSignal(false);
  const [activeWindow, setActiveWindow] = createSignal(0);
  const [windowNames, setWindowNames] = createSignal<string[]>(props.session.windowNames);
  const [windowCount, setWindowCount] = createSignal(props.session.windows);
  // Holds the actual store, not a boolean -- see WebSidebar.tsx's
  // accessLogStore signal for why (Show-callback-created stores broke
  // reactivity live, task #18a).
  const [envEditorStore, setEnvEditorStore] = createSignal<EnvFileEditorStore | null>(null);
  // Any Popup opened from within this pane (environment dropdown, stop
  // confirm, edit-config/logs dialogs) must hide the terminal's native
  // xterm.js DOM element for its duration -- TerminalView.tsx's `isVisible`
  // kdoc, same click-swallowing bug class CLAUDE.md flags. At most one of
  // these is ever open at a time, so each just reports its own open state.
  const [environmentMenuOpen, setEnvironmentMenuOpen] = createSignal(false);
  // Created once per session on the first "view logs" click, then reused
  // across service switches (LogsDialog's own store.switchService() handles
  // that without recreating the socket) -- unlike Kotlin's LogsViewModel,
  // which is torn down and rebuilt per service selection.
  const [logsStore, setLogsStore] = createSignal<LogsStore | null>(null);

  function ensureLogsStore(): LogsStore {
    const existing = logsStore();
    if (existing) return existing;
    const socket = (props.createLogsSocket ?? createLogsSocket)({ baseUrl: props.baseUrl, token: props.token });
    const created = createLogsStore({ projectId: props.projectId, sessionSlug: props.session.name, socket });
    setLogsStore(created);
    return created;
  }

  function handleViewLogs(service: string): void {
    ensureLogsStore();
    environment.showLogs(service);
  }

  function handleEditConfig(): void {
    setEnvEditorStore(createEnvFileEditorStore({ projectId: props.projectId, sessionSlug: props.session.name, api: props.api }));
  }

  const terminalVisible = () =>
    !environmentMenuOpen() && !environment.state.isShowingStopConfirm && envEditorStore() === null && environment.state.logsService === null;

  onCleanup(() => {
    terminal.dispose();
    changes.stop();
    resourceUsage.stop();
    environment.dispose();
    logsStore()?.close();
  });

  async function refreshWindows(): Promise<void> {
    const sessions = await props.api.listSessions(props.projectId);
    const fresh = sessions.find((s) => s.name === props.session.name);
    if (fresh) {
      setWindowNames(fresh.windowNames);
      setWindowCount(fresh.windows);
    }
  }

  return (
    <div class="tw-web-main-pane">
      <div class="tw-web-main-pane__content">
        <div class="tw-web-main-pane__topbar">
          <span class="tw-web-main-pane__breadcrumb">
            {props.project.name} / {props.session.name}
          </span>
          <Show when={formatResourceUsageBadge(resourceUsage.state.usage)}>
            {(text) => <span class="tw-web-main-pane__resource-usage">{text()}</span>}
          </Show>
          <div class="tw-web-main-pane__topbar-spacer" />
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
          <IconButton icon={<ChangesIcon />} label="Toggle changes" onClick={() => setRailOpen((open) => !open)} />
        </div>
        <Show when={props.pushStore.state.errorMessage}>
          {(message) => <ErrorBanner message={message()} onDismiss={props.pushStore.dismissError} />}
        </Show>
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
            onLeave={props.onSessionEnded}
            leaveLabel="Close"
          />
        </Show>
        <WindowTabs
          windowCount={windowCount()}
          activeWindow={activeWindow()}
          serverWindowNames={windowNames()}
          onSelectWindow={setActiveWindow}
          onWindowsChanged={() => void refreshWindows()}
          onInput={terminal.onInput}
        />
        <div class="tw-web-main-pane__terminal">
          <TerminalView
            onInput={terminal.onInput}
            onBell={terminal.onBell}
            onResize={terminal.onResize}
            onReady={terminal.onReady}
            isVisible={terminalVisible()}
            onScroll={terminal.onScroll}
            createTerminal={props.createTerminal}
            createFitAddon={props.createFitAddon}
            createSearchAddon={props.createSearchAddon}
          />
        </div>
      </div>
      <Show when={railOpen()}>
        <ChangesRail store={changes} class="tw-changes-rail--panel" />
      </Show>
      <DiffOverlay store={changes} backLabel="Terminal" />
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

export function WebMainPane(props: WebMainPaneProps) {
  // Keyed on the session's *identity* (fullName), not on `props` itself --
  // `props` is a stable object reference across updates (only its field
  // values change), so keying on `props` would never re-trigger a
  // teardown/rebuild of SessionPane's terminal+changes stores when the
  // user switches from one already-selected session straight to another.
  // Keying on the actual value that must change forces exactly that.
  return (
    <Show
      when={props.session && props.project && props.projectId ? props.session.fullName : null}
      keyed
      fallback={
        <div class="tw-empty-main-pane">
          <TerminalIcon />
          <p>{props.project ? `No session selected in ${props.project.name}` : "Select a session"}</p>
          <Show when={props.project}>
            <Button label="New session" icon={<ChangesIcon />} onClick={props.onNewSession} />
          </Show>
        </div>
      }
    >
      {(_sessionFullName) => (
        <SessionPane
          {...props}
          project={props.project as Project}
          session={props.session as ProjectSession}
          projectId={props.projectId as string}
        />
      )}
    </Show>
  );
}
