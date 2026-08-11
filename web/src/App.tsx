// Root component -- ports App.kt's `AdaptiveRoot`: below 900px renders the
// mobile drill-down flow (Router-based), at or above it renders the
// persistent-sidebar Web shell (Phase 7's WebShellScreen). This is the
// only width check in the app -- WebSidebar's own collapse is a separate
// manual toggle, not a second breakpoint (see WebSidebar.tsx).
//
// Route.kt's Sessions/Terminal nav args (projectName/projectRepoPath,
// sessionFullName) are threaded here via @solidjs/router's `state` option
// on navigate() rather than re-fetched, matching the Kotlin original's
// reasoning (avoid a redundant round-trip for data the caller already
// has). A direct URL load/refresh has no such state, so SessionsPage/
// TerminalPage fall back to deriving a reasonable value instead of
// crashing (e.g. `sessionFullName` = `${projectId}__${sessionSlug}`,
// matching the separator convention domain/bellAlert's title-building and
// TerminalSession.kt's `sessionLabel` derivation both already assume).
import { Route, Router, useLocation, useNavigate, useParams } from "@solidjs/router";
import { createSignal, onCleanup, Show } from "solid-js";
import { createApiClient, type ApiClient } from "./api/client";
import type { Project, ProjectSession } from "./api/types";
import { ConnectScreen } from "./screens/ConnectScreen";
import { ProjectListScreen } from "./screens/ProjectListScreen";
import { SessionListScreen } from "./screens/SessionListScreen";
import { TerminalScreen } from "./screens/TerminalScreen";
import { WebShellScreen } from "./screens/WebShellScreen";
import { createConnectionSettingsStore, type ConnectionSettingsStore } from "./stores/connectionSettingsStore";
import { createProjectListStore } from "./stores/projectListStore";
import { createPushStore, type PushStore } from "./stores/pushStore";
import { createSessionListStore } from "./stores/sessionListStore";
import { createWebShellStore } from "./stores/webShellStore";

const DESKTOP_BREAKPOINT_QUERY = "(min-width: 900px)";

export interface AppProps {
  createSettingsStore?: () => ConnectionSettingsStore;
  createApiClientImpl?: typeof createApiClient;
  // Injectable so tests never depend on jsdom's real (and largely
  // unconfigurable) viewport width -- defaults to the real matchMedia.
  matchMediaImpl?: typeof window.matchMedia;
}

/** Reactive `>=900px` flag, kept live via the media query's own change event. */
function createIsDesktop(matchMediaImpl: typeof window.matchMedia): () => boolean {
  const mql = matchMediaImpl(DESKTOP_BREAKPOINT_QUERY);
  const [isDesktop, setIsDesktop] = createSignal(mql.matches);
  const listener = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
  mql.addEventListener("change", listener);
  onCleanup(() => mql.removeEventListener("change", listener));
  return isDesktop;
}

function WebShellPage(props: {
  api: ApiClient;
  baseUrl: string;
  token: string;
  onSwitchServer: () => void;
  pushStore: PushStore;
}) {
  const store = createWebShellStore({ api: props.api });
  void store.loadProjects();
  const serverHost = () => {
    try {
      return new URL(props.baseUrl).host;
    } catch {
      return props.baseUrl;
    }
  };

  return (
    <WebShellScreen
      store={store}
      api={props.api}
      baseUrl={props.baseUrl}
      token={props.token}
      serverHost={serverHost()}
      onSwitchServer={props.onSwitchServer}
      pushStore={props.pushStore}
    />
  );
}

function ProjectsPage(props: { api: ApiClient; onSwitchServer: () => void }) {
  const navigate = useNavigate();
  const store = createProjectListStore({ api: props.api });
  void store.load();

  return (
    <ProjectListScreen
      store={store}
      api={props.api}
      onSwitchServer={props.onSwitchServer}
      onOpenProject={(project: Project) =>
        navigate(`/projects/${project.id}/sessions`, { state: { projectName: project.name } })
      }
    />
  );
}

function SessionsPage(props: { api: ApiClient }) {
  const params = useParams<{ projectId: string }>();
  const location = useLocation<{ projectName?: string } | undefined>();
  const navigate = useNavigate();
  const store = createSessionListStore({ projectId: params.projectId, api: props.api });
  void store.load();
  const projectName = () => location.state?.projectName ?? params.projectId;

  return (
    <SessionListScreen
      store={store}
      projectName={projectName()}
      onBack={() => navigate("/")}
      onOpenSession={(session: ProjectSession) =>
        navigate(`/projects/${params.projectId}/sessions/${session.name}`, {
          state: { projectName: projectName(), sessionFullName: session.fullName },
        })
      }
    />
  );
}

function TerminalPage(props: { api: ApiClient; baseUrl: string; token: string; pushStore: PushStore }) {
  const params = useParams<{ projectId: string; sessionSlug: string }>();
  const location = useLocation<{ projectName?: string; sessionFullName?: string } | undefined>();
  const navigate = useNavigate();
  const projectName = () => location.state?.projectName ?? params.projectId;

  return (
    <TerminalScreen
      api={props.api}
      baseUrl={props.baseUrl}
      token={props.token}
      projectId={params.projectId}
      sessionFullName={location.state?.sessionFullName ?? `${params.projectId}__${params.sessionSlug}`}
      sessionName={params.sessionSlug}
      projectName={projectName()}
      onBack={() =>
        navigate(`/projects/${params.projectId}/sessions`, { state: { projectName: projectName() } })
      }
      pushStore={props.pushStore}
    />
  );
}

export function App(props: AppProps = {}) {
  const settings = (props.createSettingsStore ?? createConnectionSettingsStore)();
  const createClient = props.createApiClientImpl ?? createApiClient;
  const isDesktop = createIsDesktop(props.matchMediaImpl ?? window.matchMedia.bind(window));

  return (
    <Show when={settings.state.current} fallback={<ConnectScreen store={settings} />} keyed>
      {(current) => {
        const api = createClient({ baseUrl: current.baseUrl, token: current.token });
        // Created once per connection, not per screen/session -- a push
        // subscription belongs to the browser's service-worker
        // registration, not to any particular project or session (see
        // pushStore.ts's header comment). Threaded down as a prop to
        // whichever screen currently renders the toggle rather than
        // recreated per screen, so switching sessions/navigating never
        // re-triggers its one-shot "is there already a subscription?"
        // check.
        const pushStore = createPushStore({ api });
        void pushStore.start();
        return (
          <Show
            when={isDesktop()}
            fallback={
              <Router>
                <Route path="/" component={() => <ProjectsPage api={api} onSwitchServer={settings.clear} />} />
                <Route path="/projects/:projectId/sessions" component={() => <SessionsPage api={api} />} />
                <Route
                  path="/projects/:projectId/sessions/:sessionSlug"
                  component={() => (
                    <TerminalPage api={api} baseUrl={current.baseUrl} token={current.token} pushStore={pushStore} />
                  )}
                />
              </Router>
            }
          >
            <WebShellPage
              api={api}
              baseUrl={current.baseUrl}
              token={current.token}
              onSwitchServer={settings.clear}
              pushStore={pushStore}
            />
          </Show>
        );
      }}
    </Show>
  );
}
