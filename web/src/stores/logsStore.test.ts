import { describe, expect, it, vi } from "vitest";
import { createLogsStore } from "./logsStore";

function fakeSocket() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = { open: [], data: [], close: [] };
  return {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners[event].push(listener);
    }),
    off: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    emit(event: "open" | "data" | "close", ...args: unknown[]) {
      for (const l of listeners[event]) l(...args);
    },
  };
}

describe("createLogsStore", () => {
  it("start(service) connects and appends raw chunks in arrival order", () => {
    const socket = fakeSocket();
    const store = createLogsStore({ projectId: "p", sessionSlug: "s", socket });

    store.start("app");
    expect(socket.connect).toHaveBeenCalledWith("p", "s", "app");

    socket.emit("open");
    expect(store.state.isConnected).toBe(true);

    socket.emit("data", "line one\n");
    socket.emit("data", "line two\n");
    expect(store.state.lines).toEqual(["line one\n", "line two\n"]);
  });

  it("switchService closes the current socket and reconnects with a fresh (empty) buffer", () => {
    const socket = fakeSocket();
    const store = createLogsStore({ projectId: "p", sessionSlug: "s", socket });
    store.start("app");
    socket.emit("open");
    socket.emit("data", "old output");

    store.switchService("worker");

    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.connect).toHaveBeenLastCalledWith("p", "s", "worker");
    expect(store.state.lines).toEqual([]);
    expect(store.state.isConnected).toBe(false);
  });

  it("auto-reconnects with backoff after an unexpected close, but not after a manual close/switch", async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const wait = vi.fn().mockResolvedValue(undefined);
    const store = createLogsStore({ projectId: "p", sessionSlug: "s", socket, wait });
    store.start("app");
    socket.emit("open");

    socket.emit("close");
    expect(store.state.isConnected).toBe(false);
    await Promise.resolve();
    expect(wait).toHaveBeenCalledWith(1000);
    await Promise.resolve();
    expect(socket.connect).toHaveBeenLastCalledWith("p", "s", "app");

    // Manual close must not schedule a reconnect.
    wait.mockClear();
    store.close();
    socket.emit("close");
    await Promise.resolve();
    expect(wait).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("reconnect() manually re-attaches to the currently selected service", () => {
    const socket = fakeSocket();
    const store = createLogsStore({ projectId: "p", sessionSlug: "s", socket });
    store.start("app");
    socket.emit("open");
    socket.emit("data", "some output");

    store.reconnect();

    expect(socket.connect).toHaveBeenLastCalledWith("p", "s", "app");
  });
});
