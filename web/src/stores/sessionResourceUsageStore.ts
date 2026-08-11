// Ports presentation/SessionResourceUsageViewModel.kt (EMB-214) -- polls a
// session's CPU/mem every 5s, same cadence/epoch-guarded start()/stop()
// shape as changesStore.ts. Silent-fail like the Environment status poll: a
// transient hiccup every 5s must never pop an error banner over the
// terminal -- it just leaves the last good reading on screen (or null,
// before the first successful poll) until the next successful one.
import { createStore } from "solid-js/store";
import type { ApiClient } from "../api/client";
import type { SessionResourceUsage } from "../api/types";

const POLL_INTERVAL_MS = 5000;

export interface SessionResourceUsageState {
  usage: SessionResourceUsage | null;
}

export interface SessionResourceUsageStoreDeps {
  projectId: string;
  sessionSlug: string;
  api: Pick<ApiClient, "getSessionResourceUsage">;
  wait?: (ms: number) => Promise<void>;
}

const realWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createSessionResourceUsageStore(deps: SessionResourceUsageStoreDeps) {
  const { projectId, sessionSlug, api } = deps;
  const wait = deps.wait ?? realWait;
  let pollEpoch = 0;

  const [state, setState] = createStore<SessionResourceUsageState>({ usage: null });

  async function refresh(): Promise<void> {
    try {
      const usage = await api.getSessionResourceUsage(projectId, sessionSlug);
      setState({ usage });
    } catch {
      // Silently ignored -- see doc comment above.
    }
  }

  function start(): void {
    const epoch = ++pollEpoch;
    void refresh();
    void pollLoop(epoch);
  }

  async function pollLoop(epoch: number): Promise<void> {
    for (;;) {
      await wait(POLL_INTERVAL_MS);
      if (epoch !== pollEpoch) return;
      await refresh();
    }
  }

  function stop(): void {
    pollEpoch += 1;
  }

  return { state, start, stop };
}

export type SessionResourceUsageStore = ReturnType<typeof createSessionResourceUsageStore>;
