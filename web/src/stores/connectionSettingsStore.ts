// Ports presentation/ConnectionSettingsViewModel.kt. Unlike the Kotlin
// original, there is no `isLoaded` gate: Kotlin's ConnectionSettingsStore
// is backed by an expect/actual DataStore that can genuinely be async on
// some platforms, but api/connectionSettings.ts reads localStorage, which
// is synchronous in every browser -- there is nothing to await, so the
// loading-spinner branch App.kt's `when` has for this is dropped as a
// deliberate simplification, not a fidelity gap.
import { createStore } from "solid-js/store";
import { createApiClient } from "../api/client";
import {
  clearConnectionSettings,
  loadConnectionSettings,
  saveConnectionSettings,
  type ConnectionSettings,
} from "../api/connectionSettings";
import { parseServerUrl } from "../domain/serverUrl";
import { toUiMessage } from "./errorMessage";

export interface ConnectionSettingsState {
  current: ConnectionSettings | null;
  serverUrlText: string;
  token: string;
  isTesting: boolean;
  errorMessage: string | null;
}

export interface ConnectionSettingsStoreDeps {
  // Injectable so tests never hit a real network -- defaults to a real
  // connectivity probe against the entered server (mirrors
  // data/remote/ConnectionTester.kt).
  testConnection?: (config: { baseUrl: string; token: string }) => Promise<void>;
  // window.location.origin is meaningless as a *default server* under
  // jsdom's test origin; injectable for tests. Defaults to the real value
  // -- see CLAUDE.md's "DefaultServerUrl.kt" note: this PWA always serves
  // the API from the same origin it's loaded from, so prefilling removes
  // the need to type/paste the Server URL field at all.
  defaultServerUrl?: () => string | null;
  // window.isSecureContext -- see CLAUDE.md's clipboard-paste investigation
  // note for why this matters (paste is unavailable on insecure origins).
  isSecureContext?: () => boolean;
}

const defaultTestConnection = async (config: { baseUrl: string; token: string }): Promise<void> => {
  await createApiClient(config).listProjects();
};

const realDefaultServerUrl = (): string | null =>
  typeof window !== "undefined" ? window.location.origin : null;

const realIsSecureContext = (): boolean => (typeof window !== "undefined" ? window.isSecureContext : true);

export function createConnectionSettingsStore(deps: ConnectionSettingsStoreDeps = {}) {
  const testConnection = deps.testConnection ?? defaultTestConnection;
  const getDefaultServerUrl = deps.defaultServerUrl ?? realDefaultServerUrl;
  const getIsSecureContext = deps.isSecureContext ?? realIsSecureContext;

  const saved = loadConnectionSettings();
  const [state, setState] = createStore<ConnectionSettingsState>({
    current: saved,
    serverUrlText: saved?.baseUrl ?? getDefaultServerUrl() ?? "",
    token: saved?.token ?? "",
    isTesting: false,
    errorMessage: null,
  });

  function updateServerUrlText(text: string): void {
    setState({ serverUrlText: text, errorMessage: null });
  }

  function updateToken(text: string): void {
    setState({ token: text, errorMessage: null });
  }

  function canSubmit(): boolean {
    return state.serverUrlText.trim() !== "" && state.token.trim() !== "" && !state.isTesting;
  }

  function pasteRestricted(): boolean {
    return !getIsSecureContext();
  }

  async function testAndSave(): Promise<void> {
    const baseUrl = parseServerUrl(state.serverUrlText);
    if (!baseUrl) {
      setState({ errorMessage: "Enter a valid server URL." });
      return;
    }
    const token = state.token.trim();
    if (!token) {
      setState({ errorMessage: "Enter your access token." });
      return;
    }
    setState({ isTesting: true, errorMessage: null });
    try {
      await testConnection({ baseUrl, token });
      saveConnectionSettings(baseUrl, token);
      setState({ isTesting: false, current: { baseUrl, token } });
    } catch (error) {
      setState({ isTesting: false, errorMessage: toUiMessage(error) });
    }
  }

  /** "Switch server" -- clears saved settings and returns to the Connect screen. */
  function clear(): void {
    clearConnectionSettings();
    setState({
      current: null,
      serverUrlText: getDefaultServerUrl() ?? "",
      token: "",
      errorMessage: null,
    });
  }

  return { state, updateServerUrlText, updateToken, testAndSave, clear, canSubmit, pasteRestricted };
}

export type ConnectionSettingsStore = ReturnType<typeof createConnectionSettingsStore>;
