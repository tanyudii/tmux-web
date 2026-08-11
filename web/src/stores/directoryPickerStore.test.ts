import { describe, expect, it, vi } from "vitest";
import { createDirectoryPickerStore } from "./directoryPickerStore";

const ROOT_LISTING = {
  path: "/home/user",
  parentPath: "/home",
  isGitRepo: false,
  entries: [
    { name: "my-app", path: "/home/user/my-app", isGitRepo: true },
    { name: "docs", path: "/home/user/docs", isGitRepo: false },
  ],
  truncated: false,
};

const CHILD_LISTING = {
  path: "/home/user/my-app",
  parentPath: "/home/user",
  isGitRepo: true,
  entries: [],
  truncated: false,
};

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    browseDirectory: vi.fn().mockResolvedValue(ROOT_LISTING),
    ...overrides,
  };
}

describe("createDirectoryPickerStore", () => {
  it("start() loads the initial (undefined-path) listing", async () => {
    const api = fakeApi();
    const store = createDirectoryPickerStore({ api });

    store.start();
    await vi.waitFor(() => expect(store.state.isLoading).toBe(false));

    expect(api.browseDirectory).toHaveBeenCalledWith(undefined);
    expect(store.state.currentPath).toBe("/home/user");
    expect(store.state.parentPath).toBe("/home");
    expect(store.state.isCurrentGitRepo).toBe(false);
    expect(store.state.entries).toEqual(ROOT_LISTING.entries);
  });

  it("open(entry) loads that entry's path", async () => {
    const api = fakeApi();
    api.browseDirectory.mockResolvedValueOnce(ROOT_LISTING).mockResolvedValueOnce(CHILD_LISTING);
    const store = createDirectoryPickerStore({ api });
    store.start();
    await vi.waitFor(() => expect(store.state.isLoading).toBe(false));

    store.open(ROOT_LISTING.entries[0]);
    await vi.waitFor(() => expect(store.state.currentPath).toBe("/home/user/my-app"));

    expect(api.browseDirectory).toHaveBeenLastCalledWith("/home/user/my-app");
    expect(store.state.isCurrentGitRepo).toBe(true);
  });

  it("up() loads the parent path", async () => {
    const api = fakeApi();
    api.browseDirectory.mockResolvedValueOnce(ROOT_LISTING).mockResolvedValueOnce(CHILD_LISTING);
    const store = createDirectoryPickerStore({ api });
    store.start();
    await vi.waitFor(() => expect(store.state.currentPath).toBe(ROOT_LISTING.path));

    store.open(ROOT_LISTING.entries[0]);
    await vi.waitFor(() => expect(store.state.currentPath).toBe(CHILD_LISTING.path));

    api.browseDirectory.mockResolvedValueOnce(ROOT_LISTING);
    store.up();
    await vi.waitFor(() => expect(store.state.currentPath).toBe(ROOT_LISTING.path));
    expect(api.browseDirectory).toHaveBeenLastCalledWith(CHILD_LISTING.parentPath);
  });

  it("up() is a no-op when parentPath is null", async () => {
    const api = fakeApi();
    api.browseDirectory.mockResolvedValueOnce({ ...ROOT_LISTING, parentPath: null });
    const store = createDirectoryPickerStore({ api });
    store.start();
    await vi.waitFor(() => expect(store.state.currentPath).toBe(ROOT_LISTING.path));
    expect(store.state.parentPath).toBeNull();

    store.up();
    // Nothing to await -- assert synchronously that no second call was queued.
    expect(api.browseDirectory).toHaveBeenCalledTimes(1);
  });

  it("a failed load leaves the previous listing in place and sets errorMessage", async () => {
    const api = fakeApi();
    api.browseDirectory.mockResolvedValueOnce(ROOT_LISTING).mockRejectedValueOnce(new Error("permission denied"));
    const store = createDirectoryPickerStore({ api });
    store.start();
    await vi.waitFor(() => expect(store.state.currentPath).toBe(ROOT_LISTING.path));

    store.open(ROOT_LISTING.entries[0]);
    await vi.waitFor(() => expect(store.state.errorMessage).toBe("permission denied"));

    expect(store.state.currentPath).toBe(ROOT_LISTING.path);
    expect(store.state.entries).toEqual(ROOT_LISTING.entries);
  });

  it("retry() re-issues the last attempted request", async () => {
    const api = fakeApi();
    api.browseDirectory.mockResolvedValueOnce(ROOT_LISTING).mockRejectedValueOnce(new Error("boom"));
    const store = createDirectoryPickerStore({ api });
    store.start();
    await vi.waitFor(() => expect(store.state.currentPath).toBe(ROOT_LISTING.path));
    store.open(ROOT_LISTING.entries[0]);
    await vi.waitFor(() => expect(store.state.errorMessage).toBe("boom"));

    api.browseDirectory.mockResolvedValueOnce(CHILD_LISTING);
    store.retry();
    await vi.waitFor(() => expect(store.state.currentPath).toBe(CHILD_LISTING.path));

    expect(api.browseDirectory).toHaveBeenLastCalledWith("/home/user/my-app");
    expect(store.state.errorMessage).toBeNull();
  });
});
