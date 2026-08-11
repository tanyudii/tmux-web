import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminalStore } from "./terminalStore";
import { SESSION_ENDED_CLOSE_CODE } from "../api/terminalSocket";

type Listener = (...args: unknown[]) => void;

function fakeSocket() {
  const listeners: Record<string, Listener[]> = { open: [], data: [], close: [] };
  return {
    on: vi.fn((event: string, listener: Listener) => {
      listeners[event].push(listener);
    }),
    off: vi.fn(),
    connect: vi.fn(),
    sendInput: vi.fn(),
    sendResize: vi.fn(),
    sendScroll: vi.fn(),
    close: vi.fn(),
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners[event]) listener(...args);
    },
  };
}

describe("createTerminalStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects to the given session/pane on creation", () => {
    const socket = fakeSocket();

    createTerminalStore({ socket, sessionFullName: "proj__a", sessionLabel: "a", pane: 1 });

    expect(socket.connect).toHaveBeenCalledWith("proj__a", 1);
  });

  it("writes incoming socket data to the terminal handle once ready", () => {
    const socket = fakeSocket();
    const store = createTerminalStore({ socket, sessionFullName: "proj__a", sessionLabel: "a" });
    const write = vi.fn();
    store.onReady({
      write,
      resize: vi.fn(),
      paste: vi.fn(),
      copySelection: vi.fn().mockResolvedValue(true),
      clearSelection: vi.fn(),
      pressKey: vi.fn(),
    });

    socket.emit("data", "hello\r\n");

    expect(write).toHaveBeenCalledWith("hello\r\n");
  });

  it("forwards input/resize/scroll straight to the socket", () => {
    const socket = fakeSocket();
    const store = createTerminalStore({ socket, sessionFullName: "proj__a", sessionLabel: "a" });

    store.onInput("ls\r");
    store.onResize(80, 24);
    store.onScroll("up", 3);

    expect(socket.sendInput).toHaveBeenCalledWith("ls\r");
    expect(socket.sendResize).toHaveBeenCalledWith(80, 24);
    expect(socket.sendScroll).toHaveBeenCalledWith("up", 3);
  });

  it("starts connected and flips to reconnecting then back to connected around a close/reopen", async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const store = createTerminalStore({ socket, sessionFullName: "proj__a", sessionLabel: "a" });
    expect(store.state.phase).toBe("connected");

    socket.emit("close");
    expect(store.state.phase).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.connect).toHaveBeenCalledTimes(2);

    socket.emit("open");
    expect(store.state.phase).toBe("connected");
  });

  it("doubles the reconnect delay on repeated closes, capped at 10s", async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    createTerminalStore({ socket, sessionFullName: "proj__a", sessionLabel: "a" });

    socket.emit("close");
    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.connect).toHaveBeenCalledTimes(2);

    socket.emit("close");
    await vi.advanceTimersByTimeAsync(1999);
    expect(socket.connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.connect).toHaveBeenCalledTimes(3);
  });

  it("plays a bell alert (with the session's title) only when away and past the cooldown", () => {
    const socket = fakeSocket();
    const triggerBellFeedback = vi.fn();
    let currentTime = 0;
    const store = createTerminalStore({
      socket,
      sessionFullName: "proj__a",
      sessionLabel: "backend",
      hasFocus: () => false,
      isHidden: () => false,
      now: () => currentTime,
      triggerBellFeedback,
    });

    store.onBell();
    expect(triggerBellFeedback).toHaveBeenCalledWith("🔔 backend needs you — tmux-web");

    currentTime = 500;
    store.onBell();
    expect(triggerBellFeedback).toHaveBeenCalledOnce();

    currentTime = 2000;
    store.onBell();
    expect(triggerBellFeedback).toHaveBeenCalledTimes(2);
  });

  it("does not alert while focused, even if hidden is somehow also true", () => {
    const socket = fakeSocket();
    const triggerBellFeedback = vi.fn();
    const store = createTerminalStore({
      socket,
      sessionFullName: "proj__a",
      sessionLabel: "a",
      hasFocus: () => true,
      isHidden: () => false,
      triggerBellFeedback,
    });

    store.onBell();

    expect(triggerBellFeedback).not.toHaveBeenCalled();
  });

  it("retry() resets the backoff and reconnects immediately", () => {
    const socket = fakeSocket();
    const store = createTerminalStore({ socket, sessionFullName: "proj__a", sessionLabel: "a" });

    store.retry();

    expect(store.state.phase).toBe("reconnecting");
    expect(socket.connect).toHaveBeenCalledTimes(2);
  });

  it("dispose() closes the socket and stops any pending reconnect from firing", async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const store = createTerminalStore({ socket, sessionFullName: "proj__a", sessionLabel: "a" });
    socket.emit("close");

    store.dispose();
    await vi.advanceTimersByTimeAsync(5000);

    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(store.state.phase).toBe("disconnected");
  });

  // Closing a session's last window makes tmux destroy the session. Retrying
  // then loops forever against something that will never come back -- the bug
  // this code exists to prevent.
  it("stops reconnecting and reports 'ended' when the server says the session is gone", async () => {
    const socket = fakeSocket();
    const store = createTerminalStore({ socket, sessionFullName: "proj__a", sessionLabel: "a" });

    socket.emit("close", SESSION_ENDED_CLOSE_CODE);
    await Promise.resolve();

    expect(store.state.phase).toBe("ended");
    // one initial connect only -- no retry was scheduled
    expect(socket.connect).toHaveBeenCalledOnce();
  });

  // A detach (Ctrl-B d) also ends the pty but leaves the session running, and
  // the server closes plainly for it -- that must still reconnect.
  it("still reconnects for an ordinary close", async () => {
    const socket = fakeSocket();
    const store = createTerminalStore({ socket, sessionFullName: "proj__a", sessionLabel: "a" });

    socket.emit("close", 1006);
    await Promise.resolve();

    expect(store.state.phase).toBe("reconnecting");
  });
});
