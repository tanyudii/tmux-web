import { beforeEach, describe, expect, test } from "vitest";
import { clearConnectionSettings, loadConnectionSettings, saveConnectionSettings } from "./connectionSettings";

// Ports ConnectionSettingsStore.kt / TokenStore.wasmJs.kt / BaseUrlStore.wasmJs.kt:
// same localStorage keys ("tmux-web.token", "tmux-web.baseUrl") so a user
// upgrading from the KMP build to this PWA keeps their saved connection
// without re-entering the access token (same origin, same storage).
describe("connectionSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("loadConnectionSettings returns null when nothing has been saved", () => {
    expect(loadConnectionSettings()).toBeNull();
  });

  test("saveConnectionSettings then loadConnectionSettings round-trips the base URL and token", () => {
    // Arrange
    saveConnectionSettings("http://vpn-host:5309", "test-token-0123456789");

    // Act
    const settings = loadConnectionSettings();

    // Assert
    expect(settings).toEqual({ baseUrl: "http://vpn-host:5309", token: "test-token-0123456789" });
  });

  test("saveConnectionSettings persists under the KMP build's legacy localStorage keys", () => {
    saveConnectionSettings("http://vpn-host:5309", "test-token-0123456789");

    expect(localStorage.getItem("tmux-web.baseUrl")).toBe("http://vpn-host:5309");
    expect(localStorage.getItem("tmux-web.token")).toBe("test-token-0123456789");
  });

  test("loadConnectionSettings returns null when only the base URL was saved", () => {
    localStorage.setItem("tmux-web.baseUrl", "http://vpn-host:5309");

    expect(loadConnectionSettings()).toBeNull();
  });

  test("loadConnectionSettings returns null when only the token was saved", () => {
    localStorage.setItem("tmux-web.token", "test-token-0123456789");

    expect(loadConnectionSettings()).toBeNull();
  });

  test("clearConnectionSettings removes both keys", () => {
    saveConnectionSettings("http://vpn-host:5309", "test-token-0123456789");

    clearConnectionSettings();

    expect(localStorage.getItem("tmux-web.baseUrl")).toBeNull();
    expect(localStorage.getItem("tmux-web.token")).toBeNull();
    expect(loadConnectionSettings()).toBeNull();
  });
});
