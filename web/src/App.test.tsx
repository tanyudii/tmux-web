import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "./App";
import { createConnectionSettingsStore } from "./stores/connectionSettingsStore";

// jsdom in this environment does not implement window.matchMedia at all
// (calling it throws "undefined is not a function") -- App.tsx's desktop
// breakpoint check needs one injected for every render() in this file.
function fakeMatchMedia(matches: boolean): typeof window.matchMedia {
  return () =>
    ({
      matches,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as MediaQueryList;
}

describe("App", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  test("renders the Connect screen when no server is configured yet", () => {
    render(() => (
      <App
        createSettingsStore={() => createConnectionSettingsStore({ defaultServerUrl: () => null })}
        matchMediaImpl={fakeMatchMedia(false)}
      />
    ));

    expect(screen.getByRole("heading", { name: "Connect" })).toBeInTheDocument();
  });

  test("renders the mobile Project list once a server is configured, below the desktop breakpoint", async () => {
    const settingsStore = createConnectionSettingsStore({
      login: vi.fn().mockResolvedValue("secret"),
      defaultServerUrl: () => null,
    });
    settingsStore.updateServerUrlText("https://tmux.example.com");
    settingsStore.updateUsername("alice");
    settingsStore.updatePassword("secret");
    await settingsStore.testAndSave();

    const createApiClientImpl = vi.fn().mockReturnValue({
      listProjects: vi.fn().mockResolvedValue([]),
    });

    render(() => (
      <App
        createSettingsStore={() => settingsStore}
        createApiClientImpl={createApiClientImpl as never}
        matchMediaImpl={fakeMatchMedia(false)}
      />
    ));

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(createApiClientImpl).toHaveBeenCalledWith({ baseUrl: "https://tmux.example.com", token: "secret" });
  });

  test("renders the desktop Web shell once a server is configured, at/above the desktop breakpoint", async () => {
    const settingsStore = createConnectionSettingsStore({
      login: vi.fn().mockResolvedValue("secret"),
      defaultServerUrl: () => null,
    });
    settingsStore.updateServerUrlText("https://tmux.example.com");
    settingsStore.updateUsername("alice");
    settingsStore.updatePassword("secret");
    await settingsStore.testAndSave();

    const createApiClientImpl = vi.fn().mockReturnValue({
      listProjects: vi.fn().mockResolvedValue([]),
    });

    render(() => (
      <App
        createSettingsStore={() => settingsStore}
        createApiClientImpl={createApiClientImpl as never}
        matchMediaImpl={fakeMatchMedia(true)}
      />
    ));

    expect(await screen.findByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Projects" })).toBeNull();
  });
});
