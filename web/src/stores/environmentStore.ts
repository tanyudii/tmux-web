// Ports presentation/EnvironmentViewModel.kt -- setup/stop/cancel state
// machine for a session's docker-compose environment, plus a 3s status
// poll while mounted. Same epoch-guarded start()/dispose() poll shape as
// sessionResourceUsageStore.ts (silent on poll failure, same rationale:
// a transient hiccup every 3s must never pop an error banner over the
// terminal). Unlike that store, `dispose` is the name (not `stop`) because
// `stop()` here is itself a real domain action -- it calls the server's
// stopEnv endpoint -- and reusing the polling-lifecycle name for both would
// be ambiguous at every call site.
import { createStore } from "solid-js/store";
import type { ApiClient } from "../api/client";
import type { EnvStatus } from "../api/types";
import { toUiMessage } from "./errorMessage";

const POLL_INTERVAL_MS = 3000;

export interface EnvironmentUiState {
  status: EnvStatus | null;
  isBusy: boolean;
  errorMessage: string | null;
  isShowingStopConfirm: boolean;
  logsService: string | null;
}

export interface EnvironmentStoreDeps {
  projectId: string;
  sessionSlug: string;
  api: Pick<ApiClient, "getEnvStatus" | "startEnv" | "stopEnv" | "cancelEnv">;
  wait?: (ms: number) => Promise<void>;
}

const realWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createEnvironmentStore(deps: EnvironmentStoreDeps) {
  const { projectId, sessionSlug, api } = deps;
  const wait = deps.wait ?? realWait;
  let pollEpoch = 0;

  const [state, setState] = createStore<EnvironmentUiState>({
    status: null,
    isBusy: false,
    errorMessage: null,
    isShowingStopConfirm: false,
    logsService: null,
  });

  /** Silent on poll failure -- avoid popping an alert every 3s on a transient hiccup. */
  async function refresh(): Promise<void> {
    try {
      const status = await api.getEnvStatus(projectId, sessionSlug);
      setState({ status });
    } catch {
      // Silently ignored -- see doc comment above.
    }
  }

  async function pollLoop(epoch: number): Promise<void> {
    for (;;) {
      await wait(POLL_INTERVAL_MS);
      if (epoch !== pollEpoch) return;
      await refresh();
    }
  }

  function start(): void {
    const epoch = ++pollEpoch;
    void refresh();
    void pollLoop(epoch);
  }

  function dispose(): void {
    pollEpoch += 1;
  }

  async function setup(): Promise<void> {
    setState({ isBusy: true });
    try {
      await api.startEnv(projectId, sessionSlug);
      await refresh();
    } catch (error) {
      setState({ errorMessage: toUiMessage(error) });
    }
    setState({ isBusy: false });
  }

  /** Cancels an in-flight setup() -- no isBusy gate, this only asks the server to abort the one already running. */
  async function cancel(): Promise<void> {
    try {
      await api.cancelEnv(projectId, sessionSlug);
      await refresh();
    } catch (error) {
      setState({ errorMessage: toUiMessage(error) });
    }
  }

  function requestStop(): void {
    setState({ isShowingStopConfirm: true });
  }

  function cancelStop(): void {
    setState({ isShowingStopConfirm: false });
  }

  async function stop(): Promise<void> {
    setState({ isShowingStopConfirm: false, isBusy: true });
    try {
      await api.stopEnv(projectId, sessionSlug);
      await refresh();
    } catch (error) {
      setState({ errorMessage: toUiMessage(error) });
    }
    setState({ isBusy: false });
  }

  function showLogs(service: string): void {
    setState({ logsService: service });
  }

  function switchLogsService(service: string): void {
    setState({ logsService: service });
  }

  function hideLogs(): void {
    setState({ logsService: null });
  }

  function dismissError(): void {
    setState({ errorMessage: null });
  }

  return {
    state,
    start,
    dispose,
    setup,
    cancel,
    requestStop,
    cancelStop,
    stop,
    showLogs,
    switchLogsService,
    hideLogs,
    dismissError,
  };
}

export type EnvironmentStore = ReturnType<typeof createEnvironmentStore>;
