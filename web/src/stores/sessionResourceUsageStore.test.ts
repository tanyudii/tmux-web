import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionResourceUsageStore } from "./sessionResourceUsageStore";

const USAGE_A = { available: true, services: [{ service: "app", cpuPercent: 12.5, memUsageBytes: 1e8, memLimitBytes: 1e9 }] };

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    getSessionResourceUsage: vi.fn().mockResolvedValue(USAGE_A),
    ...overrides,
  };
}

describe("createSessionResourceUsageStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with usage = null (renders nothing until the first poll)", () => {
    const store = createSessionResourceUsageStore({ projectId: "p", sessionSlug: "s", api: fakeApi() });

    expect(store.state.usage).toBeNull();
  });

  it("start() fetches immediately and then polls every 5s until stop()", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const store = createSessionResourceUsageStore({ projectId: "p", sessionSlug: "s", api });

    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getSessionResourceUsage).toHaveBeenCalledTimes(1);
    expect(store.state.usage).toEqual(USAGE_A);

    await vi.advanceTimersByTimeAsync(5000);
    expect(api.getSessionResourceUsage).toHaveBeenCalledTimes(2);

    store.stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(api.getSessionResourceUsage).toHaveBeenCalledTimes(2);
  });

  it("a failed poll silently keeps the last good reading (no error surfaced)", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    api.getSessionResourceUsage.mockResolvedValueOnce(USAGE_A).mockRejectedValueOnce(new Error("boom"));
    const store = createSessionResourceUsageStore({ projectId: "p", sessionSlug: "s", api });

    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.usage).toEqual(USAGE_A);

    await vi.advanceTimersByTimeAsync(5000);

    expect(store.state.usage).toEqual(USAGE_A);
    store.stop();
  });
});
