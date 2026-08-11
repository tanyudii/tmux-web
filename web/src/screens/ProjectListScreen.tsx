// Ports kmp/.../ui/projects/ProjectListScreen.kt. Delete is a always-visible
// trailing icon button rather than a swipe gesture -- this PWA targets
// "web-friendly, not a mobile port" (see ConnectScreen's Kotlin source
// comment for the same framing), and a hidden swipe-to-reveal action has
// no discoverable affordance on desktop trackpads/mice anyway.
import { For, Show } from "solid-js";
import { ConfirmDialog, EmptyState, ErrorBanner, IconButton, ListRow, LogoutIcon, NavBar } from "../ui";
import type { ProjectListStore } from "../stores/projectListStore";
import type { ApiClient } from "../api/client";
import type { Project } from "../api/types";
import { NewProjectSheet } from "./NewProjectSheet";

export interface ProjectListScreenProps {
  store: ProjectListStore;
  api: Pick<ApiClient, "browseDirectory">;
  onOpenProject: (project: Project) => void;
  onSwitchServer: () => void;
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 3.5v11M3.5 9h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}

function FolderRowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M2.5 5a1 1 0 011-1h3.4l1.1 1.3H14.5a1 1 0 011 1V13a1 1 0 01-1 1h-11a1 1 0 01-1-1V5z"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function TrashRowIcon() {
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

export function ProjectListScreen(props: ProjectListScreenProps) {
  const { store } = props;

  return (
    <div class="tw-screen">
      <NavBar
        title="Projects"
        large
        leading={<IconButton icon={<LogoutIcon />} label="Log out" onClick={props.onSwitchServer} />}
        right={<IconButton icon={<PlusIcon />} label="Add project" onClick={store.showNewProjectSheet} />}
      />
      <Show when={store.state.errorMessage}>
        <ErrorBanner message={store.state.errorMessage ?? ""} onDismiss={store.dismissError} />
      </Show>
      <div class="tw-screen__scroll">
        <Show
          when={!store.state.isLoading && store.state.projects.length === 0}
        >
          <EmptyState icon={<FolderRowIcon />} title="No projects" subtitle="Tap + to add one" />
        </Show>
        <For each={store.state.projects}>
          {(project) => (
            <ListRow
              title={project.name}
              subtitle={project.repoPath}
              icon={<FolderRowIcon />}
              onClick={() => props.onOpenProject(project)}
              trailing={
                <span onClick={(event) => event.stopPropagation()}>
                  <IconButton
                    icon={<TrashRowIcon />}
                    label={`Delete ${project.name}`}
                    variant="danger"
                    size="sm"
                    onClick={() => store.requestDeleteProject(project)}
                  />
                </span>
              }
            />
          )}
        </For>
      </div>
      <Show when={store.state.newProject}>
        {(newProject) => (
          <NewProjectSheet
            state={newProject()}
            api={props.api}
            onSave={(name, repoPath) => void store.createProject(name, repoPath)}
            onCancel={store.cancelNewProject}
          />
        )}
      </Show>
      <Show when={store.state.pendingDelete}>
        {(pending) => (
          <ConfirmDialog
            title="Delete project"
            message={pending().message}
            // Dynamic, not hardcoded: the same dialog serves the first confirm
            // and the escalated force variant the server can push it into.
            force={pending().forced}
            onConfirm={() => store.confirmDelete()}
            onCancel={store.cancelDelete}
          />
        )}
      </Show>
    </div>
  );
}
