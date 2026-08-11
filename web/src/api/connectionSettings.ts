// Ports ConnectionSettingsStore.kt (and its wasmJs TokenStore/BaseUrlStore
// actuals). Deliberately kept using the *same* localStorage keys as the
// KMP build -- same origin, same storage -- so cutting over to this PWA
// doesn't force every user to re-enter their access token.
const BASE_URL_KEY = "tmux-web.baseUrl";
const TOKEN_KEY = "tmux-web.token";

export interface ConnectionSettings {
  baseUrl: string;
  token: string;
}

export function loadConnectionSettings(): ConnectionSettings | null {
  const baseUrl = localStorage.getItem(BASE_URL_KEY);
  const token = localStorage.getItem(TOKEN_KEY);
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

export function saveConnectionSettings(baseUrl: string, token: string): void {
  localStorage.setItem(BASE_URL_KEY, baseUrl);
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearConnectionSettings(): void {
  localStorage.removeItem(BASE_URL_KEY);
  localStorage.removeItem(TOKEN_KEY);
}
