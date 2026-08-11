import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvironmentStore } from "./environmentStore";

const IDLE = { phase: "idle" as const };
const STARTING = { phase: "starting" as const };
const RUNNING = { phase: "running" as const, services: [{ service: "app", state: "running" }] };
const ERROR = { phase: "error" as const, message: "Cancelled" };

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    getEnvStatus: vi.fn().mockResolvedValue(IDLE),
    startEnv: vi.fn().mockResolvedValue(undefined),
    stopEnv: vi.fn().mockResolvedValue(undefined),
    cancelEnv: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("createEnvironmentStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with status = null", () => {
    const store = createEnvironmentStore({ projectId: "p", sessionSlug: "s", api: fakeApi() });

    expect(store.state.status).toBeNull();
  });

  it("start() fetches immediately and then polls every 3s until dispose()", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const store = createEnvironmentStore({ projectId: "p", sessionSlug: "s", api });

    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getEnvStatus).toHaveBeenCalledTimes(1);
    expect(store.state.status).toEqual(IDLE);

    await vi.advanceTimersByTimeAsync(3000);
    expect(api.getEnvStatus).toHaveBeenCalledTimes(2);

    store.dispose();
    await vi.advanceTimersByTimeAsync(20000);
    expect(api.getEnvStatus).toHaveBeenCalledTimes(2);
  });

  it("a failed poll is silent -- no error message and last known status is kept", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    api.getEnvStatus.mockResolvedValueOnce(RUNNING).mockRejectedValueOnce(new Error("hiccup"));
    const store = createEnvironmentStore({ projectId: "p", sessionSlug: "s", api });

    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.status).toEqual(RUNNING);

    await vi.advanceTimersByTimeAsync(3000);

    expect(store.state.errorMessage).toBeNull();
    expect(store.state.status).toEqual(RUNNING);
    store.dispose();
  });

  it("setup() calls startEnv and toggles busy while refreshing status", async () => {
    const api = fakeApi({ getEnvStatus: vi.fn().mockResolvedValue(STARTING) });
    const store = createEnvironmentStore({ projectId: "p", sessionSlug: "s", api });

    await store.setup();

    expect(api.startEnv).toHaveBeenCalledWith("p", "s");
    expect(store.state.isBusy).toBe(false);
    expect(store.state.status).toEqual(STARTING);
  });

  it("setup() failure surfaces an error and clears busy", async () => {
    const api = fakeApi({ startEnv: vi.fn().mockRejectedValue(new Error("docker unavailable")) });
    const store = createEnvironmentStore({ projectId: "p", sessionSlug: "s", api });

    await store.setup();

    expect(store.state.errorMessage).toBe("docker unavailable");
    expect(store.state.isBusy).toBe(false);
  });

  it("requestStop() shows the confirm and cancelStop() dismisses it without stopping", async () => {
    const api = fakeApi();
    const store = createEnvironmentStore({ projectId: "p", sessionSlug: "s", api });

    store.requestStop();
    expect(store.state.isShowingStopConfirm).toBe(true);

    store.cancelStop();

    expect(store.state.isShowingStopConfirm).toBe(false);
    expect(api.stopEnv).not.toHaveBeenCalled();
  });

  it("stop() calls stopEnv and dismisses the confirm while refreshing status", async () => {
    // No start()/poll here -- stop()'s own refresh() is the only getEnvStatus
    // call, unlike Kotlin's EnvironmentViewModel where an init-time poll loop
    // consumes the first queued value before requestStop()/stop() run.
    const api = fakeApi({ getEnvStatus: vi.fn().mockResolvedValue(IDLE) });
    const store = createEnvironmentStore({ projectId: "p", sessionSlug: "s", api });
    store.requestStop();

    await store.stop();

    expect(api.stopEnv).toHaveBeenCalledWith("p", "s");
    expect(store.state.isShowingStopConfirm).toBe(false);
    expect(store.state.status).toEqual(IDLE);
  });

  it("cancel() calls cancelEnv and refreshes status", async () => {
    const api = fakeApi({ getEnvStatus: vi.fn().mockResolvedValue(ERROR) });
    const store = createEnvironmentStore({ projectId: "p", sessionSlug: "s", api });

    await store.cancel();

    expect(api.cancelEnv).toHaveBeenCalledWith("p", "s");
    expect(store.state.status).toEqual(ERROR);
  });

  it("cancel() failure surfaces an error message", async () => {
    const api = fakeApi({ cancelEnv: vi.fn().mockRejectedValue(new Error("not currently starting")) });
    const store = createEnvironmentStore({ projectId: "p", sessionSlug: "s", api });

    await store.cancel();

    expect(store.state.errorMessage).toBe("not currently starting");
  });

  it("showLogs() sets the selected service -- switchLogsService() changes it -- hideLogs() clears it", () => {
    const store = createEnvironmentStore({ projectId: "p", sessionSlug: "s", api: fakeApi() });

    store.showLogs("web");
    expect(store.state.logsService).toBe("web");

    store.switchLogsService("worker");
    expect(store.state.logsService).toBe("worker");

    store.hideLogs();
    expect(store.state.logsService).toBeNull();
  });

  it("dismissError() clears the error message", async () => {
    const api = fakeApi({ startEnv: vi.fn().mockRejectedValue(new Error("boom")) });
    const store = createEnvironmentStore({ projectId: "p", sessionSlug: "s", api });
    await store.setup();

    store.dismissError();

    expect(store.state.errorMessage).toBeNull();
  });
});
