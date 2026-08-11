// Ports kmp/.../ui/web/WebSidebar.kt. Nested project -> session tree in a
// single scroll list (not tabs, not a flat list) -- see Phase 7 research.
// No search/filter here -- that lives in the command palette (deferred,
// task #18). Collapse is a plain boolean toggle (56px icon rail), not a
// second responsive breakpoint -- there is only one width check in the
// whole app (App.tsx's 900px gate).
import { createSignal, For, Show } from "solid-js";
import { IconButton, LogoutIcon } from "../ui";
import type { WebShellStore } from "../stores/webShellStore";
import type { ApiClient } from "../api/client";
import type { Project, ProjectSession } from "../api/types";
import { AccessLogDialog } from "./AccessLogDialog";
import { createAccessLogStore, type AccessLogStore } from "../stores/accessLogStore";

export interface WebSidebarProps {
  store: WebShellStore;
  api: Pick<ApiClient, "getAccessLog">;
  serverHost: string;
  onSwitchServer: () => void;
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4 2.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 4.5a1 1 0 011-1h3.2l1 1.2H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4.5z"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M3 3.5h7M5.5 3.5V2.7a.7.7 0 01.7-.7h.6a.7.7 0 01.7.7v.8M4.3 3.5v6.3a.8.8 0 00.8.8h2.8a.8.8 0 00.8-.8V3.5"
        stroke="currentColor"
        stroke-width="1"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function AccessLogIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 2.5h10a1 1 0 011 1V13l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3V3.5a1 1 0 011-1z"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linejoin="round"
      />
      <path d="M5.5 5.5h5M5.5 8h5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
    </svg>
  );
}

function SessionRow(props: { projectId: string; session: ProjectSession; store: WebShellStore }) {
  const active = () =>
    props.store.state.selectedProjectId === props.projectId && props.store.state.selectedSessionName === props.session.name;

  return (
    <div
      class="tw-sidebar-row tw-sidebar-row--session"
      classList={{ "tw-sidebar-row--active": active() }}
      role="button"
      tabIndex={0}
      onClick={() => props.store.selectSession(props.projectId, props.session.name)}
    >
      <span class="tw-sidebar-row__dot" classList={{ "tw-sidebar-row__dot--on": props.session.attached }} />
      <span class="tw-sidebar-row__label">{props.session.name}</span>
      <span class="tw-sidebar-row__meta">{props.session.windows}w</span>
      <span class="tw-sidebar-row__end-action" onClick={(event) => event.stopPropagation()}>
        <IconButton
          icon={<TrashIcon />}
          label={`Delete session ${props.session.name}`}
          size="sm"
          variant="danger"
          onClick={() => void props.store.requestDeleteSession(props.projectId, props.session)}
        />
      </span>
    </div>
  );
}

function ProjectNode(props: { project: Project; store: WebShellStore }) {
  const { store, project } = props;
  const expanded = () => store.state.expandedProjectIds.includes(project.id);
  const active = () => store.state.selectedProjectId === project.id && store.state.selectedSessionName === null;
  const sessions = () => store.state.sessionsByProjectId[project.id] ?? [];

  function open(): void {
    store.toggleProject(project.id);
    store.selectProject(project.id);
  }

  return (
    <div class="tw-sidebar-node">
      <div
        class="tw-sidebar-row tw-sidebar-row--project"
        classList={{ "tw-sidebar-row--active": active() }}
        role="button"
        tabIndex={0}
        onClick={open}
      >
        <span class="tw-sidebar-row__chevron" classList={{ "tw-sidebar-row__chevron--open": expanded() }}>
          <ChevronIcon />
        </span>
        <span class="tw-sidebar-row__icon">
          <FolderIcon />
        </span>
        <span class="tw-sidebar-row__texts">
          <span class="tw-sidebar-row__label">{project.name}</span>
          {/* An em dash, not "0 session(s)", until the fetch has actually
              landed -- a number here is a claim, and claiming zero for unknown
              data is exactly what looked like a bug. */}
          <span class="tw-sidebar-row__meta">
            {store.hasLoadedSessions(project.id) ? `${sessions().length} session(s)` : "—"}
          </span>
        </span>
        <span class="tw-sidebar-row__end-action" onClick={(event) => event.stopPropagation()}>
          <IconButton
            icon={<TrashIcon />}
            label={`Delete project ${project.name}`}
            size="sm"
            variant="danger"
            onClick={() => void store.requestDeleteProject(project)}
          />
        </span>
      </div>
      <Show when={expanded()}>
        <For each={sessions()}>{(session) => <SessionRow projectId={project.id} session={session} store={store} />}</For>
        <button type="button" class="tw-sidebar-row tw-sidebar-row--new-session" onClick={() => store.showNewSessionDialog(project.id)}>
          <PlusIcon />
          <span>New session</span>
        </button>
      </Show>
    </div>
  );
}

function CollapsedRail(props: { store: WebShellStore }) {
  return (
    <div class="tw-sidebar tw-sidebar--collapsed">
      <For each={props.store.state.projects}>
        {(project) => (
          <button
            type="button"
            class="tw-sidebar-collapsed-item"
            classList={{ "tw-sidebar-row--active": props.store.state.selectedProjectId === project.id }}
            aria-label={project.name}
            onClick={() => props.store.selectProject(project.id)}
          >
            <FolderIcon />
          </button>
        )}
      </For>
      <button
        type="button"
        class="tw-sidebar-collapsed-item"
        aria-label="Expand sidebar"
        onClick={() => props.store.toggleSidebarCollapsed()}
      >
        <ChevronIcon />
      </button>
    </div>
  );
}

export function WebSidebar(props: WebSidebarProps) {
  const { store } = props;
  // Holds the actual store, not a boolean -- created imperatively in the
  // click handler, not inline inside <Show>'s callback children. See
  // NewProjectSheet.tsx's DirectoryPickerDialog wiring for why: creating a
  // Solid store inside a Show callback's JSX broke its reactivity live
  // (button state got stuck), reproduced and fixed during task #18a.
  const [accessLogStore, setAccessLogStore] = createSignal<AccessLogStore | null>(null);

  return (
    <Show when={!store.state.sidebarCollapsed} fallback={<CollapsedRail store={store} />}>
      <div class="tw-sidebar">
        <div class="tw-sidebar__header">
          <span>PROJECTS</span>
          <IconButton icon={<PlusIcon />} label="New project" size="sm" onClick={store.showNewProjectDialog} />
        </div>
        <div class="tw-sidebar__scroll">
          <For each={store.state.projects}>{(project) => <ProjectNode project={project} store={store} />}</For>
        </div>
        <div class="tw-sidebar__footer">
          <button type="button" class="tw-sidebar-row" onClick={props.onSwitchServer}>
            <LogoutIcon size={16} />
            <span class="tw-sidebar-row__texts">
              <span class="tw-sidebar-row__label">Log out</span>
              <span class="tw-sidebar-row__meta">{props.serverHost}</span>
            </span>
          </button>
          <IconButton
            icon={<AccessLogIcon />}
            label="Access log"
            size="sm"
            onClick={() => setAccessLogStore(createAccessLogStore({ api: props.api }))}
          />
          <IconButton icon={<ChevronIcon />} label="Collapse sidebar" size="sm" onClick={store.toggleSidebarCollapsed} />
        </div>
      </div>
      <Show when={accessLogStore()}>
        {(accessLog) => <AccessLogDialog store={accessLog()} onDismiss={() => setAccessLogStore(null)} />}
      </Show>
    </Show>
  );
}
