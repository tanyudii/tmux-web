import { describe, expect, it, vi } from "vitest";
import { createAccessLogStore } from "./accessLogStore";

const ENTRY_A = { timestamp: "2026-01-01T00:00:00Z", ip: "127.0.0.1", method: "GET", path: "/api/projects", outcome: "authorized" };

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    getAccessLog: vi.fn().mockResolvedValue([ENTRY_A]),
    ...overrides,
  };
}

describe("createAccessLogStore", () => {
  it("refresh() loads entries", async () => {
    const api = fakeApi();
    const store = createAccessLogStore({ api });

    await store.refresh();

    expect(api.getAccessLog).toHaveBeenCalledOnce();
    expect(store.state.entries).toEqual([ENTRY_A]);
    expect(store.state.isLoading).toBe(false);
  });

  it("starts with isLoading true before the first refresh resolves", () => {
    const store = createAccessLogStore({ api: fakeApi() });

    expect(store.state.isLoading).toBe(true);
  });

  it("sets errorMessage on failure", async () => {
    const store = createAccessLogStore({ api: fakeApi({ getAccessLog: vi.fn().mockRejectedValue(new Error("boom")) }) });

    await store.refresh();

    expect(store.state.errorMessage).toBe("boom");
    expect(store.state.isLoading).toBe(false);
  });

  it("a later refresh clears a previous error", async () => {
    const api = fakeApi();
    api.getAccessLog.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([ENTRY_A]);
    const store = createAccessLogStore({ api });
    await store.refresh();
    expect(store.state.errorMessage).toBe("boom");

    await store.refresh();

    expect(store.state.errorMessage).toBeNull();
    expect(store.state.entries).toEqual([ENTRY_A]);
  });
});
