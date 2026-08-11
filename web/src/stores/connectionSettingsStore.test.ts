import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnectionSettingsStore } from "./connectionSettingsStore";

const NOOP_DEFAULT_SERVER_URL = () => null;

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

    const store = createConnectionSettingsStore({ defaultServerUrl: NOOP_DEFAULT_SERVER_URL });

    expect(store.state.current).toEqual({ baseUrl: "https://saved.example.com", token: "saved-token" });
    expect(store.state.serverUrlText).toBe("https://saved.example.com");
    expect(store.state.token).toBe("saved-token");
  });

  it("rejects an unparseable server URL without calling testConnection", async () => {
    const testConnection = vi.fn();
    const store = createConnectionSettingsStore({ testConnection, defaultServerUrl: NOOP_DEFAULT_SERVER_URL });
    store.updateServerUrlText("not a url");
    store.updateToken("tok");

    await store.testAndSave();

    expect(testConnection).not.toHaveBeenCalled();
    expect(store.state.errorMessage).toBe("Enter a valid server URL.");
  });

  it("saves settings and sets current on a successful connection test", async () => {
    const testConnection = vi.fn().mockResolvedValue(undefined);
    const store = createConnectionSettingsStore({ testConnection, defaultServerUrl: NOOP_DEFAULT_SERVER_URL });
    store.updateServerUrlText("https://tmux.example.com");
    store.updateToken("secret-token");

    await store.testAndSave();

    expect(testConnection).toHaveBeenCalledWith({ baseUrl: "https://tmux.example.com", token: "secret-token" });
    expect(store.state.current).toEqual({ baseUrl: "https://tmux.example.com", token: "secret-token" });
    expect(store.state.isTesting).toBe(false);
    expect(localStorage.getItem("tmux-web.baseUrl")).toBe("https://tmux.example.com");
  });

  it("surfaces a UI error message and leaves current unset when the connection test fails", async () => {
    const testConnection = vi.fn().mockRejectedValue(new Error("Token is invalid or expired."));
    const store = createConnectionSettingsStore({ testConnection, defaultServerUrl: NOOP_DEFAULT_SERVER_URL });
    store.updateServerUrlText("https://tmux.example.com");
    store.updateToken("bad-token");

    await store.testAndSave();

    expect(store.state.current).toBeNull();
    expect(store.state.errorMessage).toBe("Token is invalid or expired.");
    expect(store.state.isTesting).toBe(false);
  });

  it("reports isTesting true while the connection test is in flight", async () => {
    let resolveTest: () => void = () => {};
    const testConnection = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTest = resolve;
        }),
    );
    const store = createConnectionSettingsStore({ testConnection, defaultServerUrl: NOOP_DEFAULT_SERVER_URL });
    store.updateServerUrlText("https://tmux.example.com");
    store.updateToken("tok");

    const pending = store.testAndSave();
    expect(store.state.isTesting).toBe(true);
    expect(store.canSubmit()).toBe(false);
    resolveTest();
    await pending;

    expect(store.state.isTesting).toBe(false);
  });

  it("clear() removes saved settings and resets back to the default server URL", async () => {
    const testConnection = vi.fn().mockResolvedValue(undefined);
    const store = createConnectionSettingsStore({ testConnection, defaultServerUrl: () => "https://default.example.com" });
    store.updateServerUrlText("https://tmux.example.com");
    store.updateToken("tok");
    await store.testAndSave();

    store.clear();

    expect(store.state.current).toBeNull();
    expect(store.state.serverUrlText).toBe("https://default.example.com");
    expect(store.state.token).toBe("");
    expect(localStorage.getItem("tmux-web.baseUrl")).toBeNull();
  });

  it("reports pasteRestricted from the injected isSecureContext check", () => {
    const insecure = createConnectionSettingsStore({ isSecureContext: () => false, defaultServerUrl: NOOP_DEFAULT_SERVER_URL });
    expect(insecure.pasteRestricted()).toBe(true);

    const secure = createConnectionSettingsStore({ isSecureContext: () => true, defaultServerUrl: NOOP_DEFAULT_SERVER_URL });
    expect(secure.pasteRestricted()).toBe(false);
  });
});
