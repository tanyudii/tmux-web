// Ports presentation/ConnectionSettingsViewModel.kt. Unlike the Kotlin
// original, there is no `isLoaded` gate: Kotlin's ConnectionSettingsStore
// is backed by an expect/actual DataStore that can genuinely be async on
// some platforms, but api/connectionSettings.ts reads localStorage, which
// is synchronous in every browser -- there is nothing to await, so the
// loading-spinner branch App.kt's `when` has for this is dropped as a
// deliberate simplification, not a fidelity gap.
import { createStore } from "solid-js/store";
import { createApiClient, loginRequest } from "../api/client";
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
  username: string;
  password: string;
  isTesting: boolean;
  errorMessage: string | null;
}

export interface ConnectionSettingsStoreDeps {
  // Injectable so tests never hit a real network -- defaults to a real
  // POST /api/login against the entered server; resolves to the issued
  // bearer token on success.
  login?: (config: { baseUrl: string; username: string; password: string }) => Promise<string>;
  // Best-effort token revocation (POST /api/logout) when the user
  // disconnects; injectable for the same reason as login.
  logout?: (config: { baseUrl: string; token: string }) => Promise<void>;
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

const defaultLogin = async (config: { baseUrl: string; username: string; password: string }): Promise<string> =>
  loginRequest(config);

const defaultLogout = async (config: { baseUrl: string; token: string }): Promise<void> => {
  await createApiClient(config).logout();
};

const realDefaultServerUrl = (): string | null =>
  typeof window !== "undefined" ? window.location.origin : null;

const realIsSecureContext = (): boolean => (typeof window !== "undefined" ? window.isSecureContext : true);

export function createConnectionSettingsStore(deps: ConnectionSettingsStoreDeps = {}) {
  const login = deps.login ?? defaultLogin;
  const logout = deps.logout ?? defaultLogout;
  const getDefaultServerUrl = deps.defaultServerUrl ?? realDefaultServerUrl;
  const getIsSecureContext = deps.isSecureContext ?? realIsSecureContext;

  const saved = loadConnectionSettings();
  const [state, setState] = createStore<ConnectionSettingsState>({
    current: saved,
    serverUrlText: saved?.baseUrl ?? getDefaultServerUrl() ?? "",
    username: "",
    password: "",
    isTesting: false,
    errorMessage: null,
  });

  function updateServerUrlText(text: string): void {
    setState({ serverUrlText: text, errorMessage: null });
  }

  function updateUsername(text: string): void {
    setState({ username: text, errorMessage: null });
  }

  function updatePassword(text: string): void {
    setState({ password: text, errorMessage: null });
  }

  function canSubmit(): boolean {
    return (
      state.serverUrlText.trim() !== "" && state.username.trim() !== "" && state.password !== "" && !state.isTesting
    );
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
    const username = state.username.trim();
    const password = state.password;
    if (!username || !password) {
      setState({ errorMessage: "Enter your username and password." });
      return;
    }
    setState({ isTesting: true, errorMessage: null });
    try {
      const token = await login({ baseUrl, username, password });
      saveConnectionSettings(baseUrl, token);
      setState({ isTesting: false, current: { baseUrl, token } });
    } catch (error) {
      setState({ isTesting: false, errorMessage: toUiMessage(error) });
    }
  }

  /** "Switch server" -- revokes the token, clears saved settings, and returns to the Connect screen. */
  function clear(): void {
    // Best-effort: never blocks or fails the disconnect itself.
    if (state.current) void logout(state.current).catch(() => {});
    clearConnectionSettings();
    setState({
      current: null,
      serverUrlText: getDefaultServerUrl() ?? "",
      username: "",
      password: "",
      errorMessage: null,
    });
  }

  return { state, updateServerUrlText, updateUsername, updatePassword, testAndSave, clear, canSubmit, pasteRestricted };
}

export type ConnectionSettingsStore = ReturnType<typeof createConnectionSettingsStore>;
