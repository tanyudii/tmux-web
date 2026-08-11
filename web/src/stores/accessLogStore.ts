// Ports presentation/AccessLogViewModel.kt -- backs the read-only access-log
// dialog (EMB-223) reachable from the Web sidebar's footer. Server-wide,
// not per-project/session (matches GET /api/access-log taking no args).
import { createStore } from "solid-js/store";
import type { ApiClient } from "../api/client";
import type { AccessLogEntry } from "../api/types";
import { toUiMessage } from "./errorMessage";

export interface AccessLogState {
  entries: AccessLogEntry[];
  isLoading: boolean;
  errorMessage: string | null;
}

export interface AccessLogStoreDeps {
  api: Pick<ApiClient, "getAccessLog">;
}

export function createAccessLogStore(deps: AccessLogStoreDeps) {
  const { api } = deps;

  const [state, setState] = createStore<AccessLogState>({
    entries: [],
    isLoading: true,
    errorMessage: null,
  });

  async function refresh(): Promise<void> {
    setState({ isLoading: true, errorMessage: null });
    try {
      const entries = await api.getAccessLog();
      setState({ entries, isLoading: false });
    } catch (error) {
      setState({ isLoading: false, errorMessage: toUiMessage(error) });
    }
  }

  return { state, refresh };
}

export type AccessLogStore = ReturnType<typeof createAccessLogStore>;
