// Ports kmp/.../ui/sessions/SessionListScreen.kt (+SessionRows.kt's row
// rendering, folded in here as a local subcomponent rather than a
// separate file since it has no state of its own).
//
// Deliberate simplification vs. the Kotlin original: no separate
// "CreatingSessionCard" list-level indicator. NewSessionSheet (below) is
// already gated 1:1 on `sessionCreation !== null` and shows the exact same
// progress bar/message while open, so a second surface for the same state
// would be redundant here; not a capability gap. Also not ported: the
// "Delete project" entry point Kotlin exposes from *within* this screen
// (a local `DeleteProjectState` talking straight to `ProjectsRepository`)
// -- project deletion already has a full affordance on the Project list
// screen itself, so this would only be a shortcut duplicate.
import { For, Show, createEffect, createSignal } from "solid-js";
import { ConfirmDialog, EmptyState, ErrorBanner, Group, IconButton, ListRow, NavBar, StatusBadge } from "../ui";
import type { SessionListStore } from "../stores/sessionListStore";
import type { ProjectSession } from "../api/types";
import { NewSessionSheet } from "./NewSessionSheet";
import { SessionFilterBar } from "./SessionFilterBar";
import { SessionLabelSheet } from "./SessionLabelSheet";

export interface SessionListScreenProps {
  store: SessionListStore;
  projectName: string;
  onOpenSession: (session: ProjectSession) => void;
  onBack: () => void;
}

function TerminalRowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3" />
      <path d="M5 7l2.5 2-2.5 2M9 11h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 3.5v11M3.5 9h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 4.5h9M6.5 4.5V3a1 1 0 011-1h1a1 1 0 011 1v1.5M5 4.5v8a1 1 0 001 1h4a1 1 0 001-1v-8"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function StarIcon(props: { filled: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill={props.filled ? "currentColor" : "none"} aria-hidden="true">
      <path
        d="M7.5 1.5l1.8 3.7 4 .6-2.9 2.9.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.9 4-.6L7.5 1.5z"
        stroke="currentColor"
        stroke-width="1"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M9.6 2.4a1.2 1.2 0 011.7 1.7L4.9 11.5l-2.4.6.6-2.4 6.5-6.3z"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function CheckboxIcon(props: { checked: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="14" height="14" rx="4" stroke="currentColor" stroke-width="1.4" />
      <Show when={props.checked}>
        <path d="M6.5 10.2l2.3 2.3 4.7-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </Show>
    </svg>
  );
}

// A plain `if (props.isSelectionMode) return <...>` here would be wrong:
// Solid component bodies run once per mount, so a JS `if` branching on a
// prop that changes *after* mount (toggling selection mode while rows are
// already mounted) would freeze every row on whichever branch was true the
// first time it rendered. `<Show>` is Solid's actual reactive conditional
// -- it re-evaluates its `when` on every change and swaps the DOM subtree,
// which a bare `if` does not.
function SessionRow(props: {
  session: ProjectSession;
  isSelectionMode: boolean;
  isSelected: boolean;
  onOpen: () => void;
  onToggleSelected: () => void;
  onToggleFavorite: () => void;
  onEditLabel: () => void;
}) {
  const s = () => props.session;

  return (
    <Show
      when={props.isSelectionMode}
      fallback={
        <ListRow
          title={s().name}
          subtitle={`${s().windows} window(s)`}
          icon={<TerminalRowIcon />}
          onClick={props.onOpen}
          trailing={
            // Only the two actual interactive controls stop propagation
            // (each narrowly, around just that button) -- not the whole
            // cluster. A wrapping stopPropagation around badges too would
            // silently swallow taps that land in the gaps between them,
            // since Playwright/a real tap targets the nearest element's
            // bounding box, not necessarily a button's exact pixels; only
            // caught by live verification (CLAUDE.md), not by any test
            // using synthetic events on named locators.
            <span class="tw-session-row__actions">
              <Show when={s().label}>
                <StatusBadge label={s().label ?? ""} tone="info" mono />
              </Show>
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton
                  icon={<StarIcon filled={s().favorite} />}
                  label={`${s().favorite ? "Unfavorite" : "Favorite"} ${s().name}`}
                  size="sm"
                  onClick={props.onToggleFavorite}
                />
              </span>
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton
                  icon={<PencilIcon />}
                  label={`Edit label for ${s().name}`}
                  size="sm"
                  onClick={props.onEditLabel}
                />
              </span>
              <StatusBadge label={s().attached ? "attached" : "detached"} tone={s().attached ? "attached" : "idle"} dot={s().attached} />
            </span>
          }
        />
      }
    >
      <ListRow
        title={s().name}
        subtitle={`${s().windows} window(s)`}
        leading={
          <span class="tw-session-row__checkbox" aria-hidden="true">
            <CheckboxIcon checked={props.isSelected} />
          </span>
        }
        trailing={<StatusBadge label={s().attached ? "attached" : "detached"} tone={s().attached ? "attached" : "idle"} dot={s().attached} />}
        chevron={false}
        onClick={props.onToggleSelected}
      />
    </Show>
  );
}

export function SessionListScreen(props: SessionListScreenProps) {
  const { store } = props;
  const [isNewSessionOpen, setNewSessionOpen] = createSignal(false);
  const [editingLabelFor, setEditingLabelFor] = createSignal<ProjectSession | null>(null);

  // Bug found live (not by inline review or jsdom tests -- both missed it):
  // `isNewSessionOpen() || store.state.sessionCreation` (below) means the
  // sheet stayed open forever after a *successful* creation, since nothing
  // ever flipped isNewSessionOpen() back to false on success (only
  // onCancel did). The desktop dialog (WebShellScreen.tsx) never had this
  // bug -- it gates on `newSessionDialog` alone, which the store itself
  // nulls out on success. Mirror that here: once sessionCreation has gone
  // non-null (a creation actually started) and then becomes null again
  // (pollSessionCreation's "ready" branch -- never its "error" branch,
  // which sets fields on the existing object instead of nulling it), close
  // the sheet. A plain `if` wouldn't re-run on this later state change;
  // createEffect is Solid's actual reactive primitive for it.
  let hasSessionCreationStarted = false;
  createEffect(() => {
    if (store.state.sessionCreation) {
      hasSessionCreationStarted = true;
    } else if (hasSessionCreationStarted) {
      hasSessionCreationStarted = false;
      setNewSessionOpen(false);
    }
  });

  const favorites = () => store.filteredSessions().filter((s) => s.favorite);
  const rest = () => store.filteredSessions().filter((s) => !s.favorite);

  return (
    <div class="tw-screen">
      <NavBar
        title={props.projectName}
        back={{ label: "Projects", onClick: props.onBack }}
        right={
          <>
            <IconButton
              icon={<CheckboxIcon checked={store.state.isSelectionMode} />}
              label={store.state.isSelectionMode ? "Cancel selection" : "Select sessions"}
              onClick={store.toggleSelectionMode}
            />
            <IconButton
              icon={<PlusIcon />}
              label="New session"
              onClick={() => {
                setNewSessionOpen(true);
                void store.loadTemplates();
              }}
            />
          </>
        }
      />
      <Show when={store.state.errorMessage}>
        <ErrorBanner message={store.state.errorMessage ?? ""} onDismiss={store.dismissError} />
      </Show>
      <SessionFilterBar
        statusFilter={store.state.statusFilter}
        onStatusFilterChange={store.setStatusFilter}
        branchQuery={store.state.branchQuery}
        onBranchQueryChange={store.setBranchQuery}
      />
      <Show when={store.state.isSelectionMode}>
        <div class="tw-bulk-delete-bar">
          <span>{store.state.selectedNames.length} selected</span>
          <IconButton
            icon={<TrashIcon />}
            label={`Delete selected (${store.state.selectedNames.length})`}
            variant="danger"
            disabled={store.state.selectedNames.length === 0}
            onClick={store.requestBulkDelete}
          />
        </div>
      </Show>
      <div class="tw-screen__scroll">
        <Show when={!store.state.isLoading && store.filteredSessions().length === 0}>
          <EmptyState icon={<TerminalRowIcon />} title="No sessions" subtitle="Tap + to start one" />
        </Show>
        <Show when={favorites().length > 0}>
          <Group header="Favorites">
            <For each={favorites()}>
              {(session) => (
                <SessionRow
                  session={session}
                  isSelectionMode={store.state.isSelectionMode}
                  isSelected={store.state.selectedNames.includes(session.name)}
                  onOpen={() => props.onOpenSession(session)}
                  onToggleSelected={() => store.toggleSessionSelected(session.name)}
                  onToggleFavorite={() => void store.setSessionMeta(session, session.label, !session.favorite)}
                  onEditLabel={() => setEditingLabelFor(session)}
                />
              )}
            </For>
          </Group>
        </Show>
        <Show when={rest().length > 0}>
          <Group header="Sessions">
            <For each={rest()}>
              {(session) => (
                <SessionRow
                  session={session}
                  isSelectionMode={store.state.isSelectionMode}
                  isSelected={store.state.selectedNames.includes(session.name)}
                  onOpen={() => props.onOpenSession(session)}
                  onToggleSelected={() => store.toggleSessionSelected(session.name)}
                  onToggleFavorite={() => void store.setSessionMeta(session, session.label, !session.favorite)}
                  onEditLabel={() => setEditingLabelFor(session)}
                />
              )}
            </For>
          </Group>
        </Show>
      </div>

      <Show when={isNewSessionOpen() || store.state.sessionCreation}>
        <NewSessionSheet
          creationState={store.state.sessionCreation}
          templates={store.state.templates}
          // Navigate straight into the session once it is ready, rather than
          // dropping the user back on the list to find and tap the thing they
          // just made -- creating a session is always a prelude to using it.
          //
          // Closing the sheet is deliberately NOT done here: the createEffect
          // above already does it on the same success signal, and duplicating
          // it would leave two mechanisms to keep in step. On failure
          // createSession resolves null, so we neither navigate nor interfere
          // with the sheet, which stays open showing
          // state.sessionCreation.errorMessage.
          onCreate={(name, startupCommand) => {
            void (async () => {
              const created = await store.createSession(name, startupCommand);
              if (created) props.onOpenSession(created);
            })();
          }}
          onSaveAsTemplate={(name, startupCommand) => void store.saveAsTemplate(name, startupCommand)}
          onDeleteTemplate={(templateId) => void store.deleteTemplate(templateId)}
          onCancel={() => {
            setNewSessionOpen(false);
            store.cancelSessionCreation();
          }}
        />
      </Show>

      <Show when={editingLabelFor()}>
        {(session) => (
          <SessionLabelSheet
            initialLabel={session().label}
            onCancel={() => setEditingLabelFor(null)}
            onSave={(label) => {
              void store.setSessionMeta(session(), label, session().favorite);
              setEditingLabelFor(null);
            }}
          />
        )}
      </Show>

      <Show when={store.state.pendingDelete}>
        {(pending) => (
          <ConfirmDialog
            title="Delete session"
            message={pending().message}
            // Dynamic: same dialog serves the first confirm and the escalated
            // force variant the server can push it into.
            force={pending().forced}
            onConfirm={() => store.confirmDelete()}
            onCancel={store.cancelForceDelete}
          />
        )}
      </Show>

      <Show when={store.state.pendingBulkDelete}>
        {(pending) => (
          <ConfirmDialog
            title="Delete sessions"
            message={`Delete ${pending().names.length} session(s)? This can't be undone.`}
            onConfirm={() => store.confirmBulkDelete()}
            onCancel={store.cancelBulkDelete}
          />
        )}
      </Show>

      <Show when={store.state.pendingBulkForceDelete}>
        {(pending) => (
          <ConfirmDialog
            title="Force delete sessions"
            message={`${pending().sessions.length} session(s) have unmerged changes.`}
            force
            onConfirm={() => store.confirmBulkForceDelete()}
            onCancel={store.cancelBulkForceDelete}
          />
        )}
      </Show>
    </div>
  );
}
