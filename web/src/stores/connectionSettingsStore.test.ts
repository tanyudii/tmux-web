import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnectionSettingsStore } from "./connectionSettingsStore";

const NOOP_DEFAULT_SERVER_URL = () => null;

function makeStore(overrides: Parameters<typeof createConnectionSettingsStore>[0] = {}) {
  return createConnectionSettingsStore({ defaultServerUrl: NOOP_DEFAULT_SERVER_URL, ...overrides });
}

describe("createConnectionSettingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("starts with no saved settings and the injected default server URL prefilled", () => {
    const store = createConnectionSettingsStore({ defaultServerUrl: () => "https://tmux.example.com" });

    expect(store.state.current).toBeNull();
    expect(store.state.serverUrlText).toBe("https://tmux.example.com");
    expect(store.canSubmit()).toBe(false);
  });

  it("loads previously saved settings from localStorage", () => {
    localStorage.setItem("tmux-web.baseUrl", "https://saved.example.com");
    localStorage.setItem("tmux-web.token", "saved-token");

    const store = makeStore();

    expect(store.state.current).toEqual({ baseUrl: "https://saved.example.com", token: "saved-token" });
    expect(store.state.serverUrlText).toBe("https://saved.example.com");
    // Credentials are never persisted -- only the issued token is.
    expect(store.state.username).toBe("");
    expect(store.state.password).toBe("");
  });

  it("rejects an unparseable server URL without calling login", async () => {
    const login = vi.fn();
    const store = makeStore({ login });
    store.updateServerUrlText("not a url");
    store.updateUsername("alice");
    store.updatePassword("secret");

    await store.testAndSave();

    expect(login).not.toHaveBeenCalled();
    expect(store.state.errorMessage).toBe("Enter a valid server URL.");
  });

  it("rejects missing credentials without calling login", async () => {
    const login = vi.fn();
    const store = makeStore({ login });
    store.updateServerUrlText("https://tmux.example.com");

    await store.testAndSave();

    expect(login).not.toHaveBeenCalled();
    expect(store.state.errorMessage).toBe("Enter your username and password.");
  });

  it("saves the issued token and sets current on a successful login", async () => {
    const login = vi.fn().mockResolvedValue("issued-token");
    const store = makeStore({ login });
    store.updateServerUrlText("https://tmux.example.com");
    store.updateUsername("alice");
    store.updatePassword("secret");

    await store.testAndSave();

    expect(login).toHaveBeenCalledWith({ baseUrl: "https://tmux.example.com", username: "alice", password: "secret" });
    expect(store.state.current).toEqual({ baseUrl: "https://tmux.example.com", token: "issued-token" });
    expect(store.state.isTesting).toBe(false);
    expect(localStorage.getItem("tmux-web.baseUrl")).toBe("https://tmux.example.com");
    expect(localStorage.getItem("tmux-web.token")).toBe("issued-token");
  });

  it("surfaces a UI error message and leaves current unset when login fails", async () => {
    const login = vi.fn().mockRejectedValue(new Error("Invalid username or password."));
    const store = makeStore({ login });
    store.updateServerUrlText("https://tmux.example.com");
    store.updateUsername("alice");
    store.updatePassword("bad");

    await store.testAndSave();

    expect(store.state.current).toBeNull();
    expect(store.state.errorMessage).toBe("Invalid username or password.");
    expect(store.state.isTesting).toBe(false);
  });

  it("reports isTesting true while the login request is in flight", async () => {
    let resolveLogin: (token: string) => void = () => {};
    const login = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    const store = makeStore({ login });
    store.updateServerUrlText("https://tmux.example.com");
    store.updateUsername("alice");
    store.updatePassword("secret");

    const pending = store.testAndSave();
    expect(store.state.isTesting).toBe(true);
    expect(store.canSubmit()).toBe(false);
    resolveLogin("issued-token");
    await pending;

    expect(store.state.isTesting).toBe(false);
  });

  it("clear() revokes the token, removes saved settings, and resets the form", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const store = makeStore({
      login: vi.fn().mockResolvedValue("issued-token"),
      logout,
      defaultServerUrl: () => "https://default.example.com",
    });
    store.updateServerUrlText("https://tmux.example.com");
    store.updateUsername("alice");
    store.updatePassword("secret");
    await store.testAndSave();

    store.clear();

    expect(logout).toHaveBeenCalledWith({ baseUrl: "https://tmux.example.com", token: "issued-token" });
    expect(store.state.current).toBeNull();
    expect(store.state.serverUrlText).toBe("https://default.example.com");
    expect(store.state.username).toBe("");
    expect(store.state.password).toBe("");
    expect(localStorage.getItem("tmux-web.baseUrl")).toBeNull();
  });

  it("reports pasteRestricted from the injected isSecureContext check", () => {
    const insecure = createConnectionSettingsStore({ isSecureContext: () => false, defaultServerUrl: NOOP_DEFAULT_SERVER_URL });
    expect(insecure.pasteRestricted()).toBe(true);

    const secure = createConnectionSettingsStore({ isSecureContext: () => true, defaultServerUrl: NOOP_DEFAULT_SERVER_URL });
    expect(secure.pasteRestricted()).toBe(false);
  });
});
