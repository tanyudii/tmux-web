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

  it("keeps the retry loop alive when connect() throws", async () => {
    const socket = fakeSocket();
    socket.connect.mockImplementationOnce(() => {}).mockImplementationOnce(() => {
      throw new Error("SecurityError");
    });
    const store = createTerminalStore({
      socket,
      sessionFullName: "proj__a",
      sessionLabel: "a",
      wait: () => Promise.resolve(),
    });

    socket.emit("close", 1006);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The throwing attempt must not leave the store stuck with no scheduled
    // follow-up -- it re-enters the backoff instead.
    expect(store.state.phase).toBe("reconnecting");
    expect(socket.connect.mock.calls.length).toBeGreaterThan(2);
  });
});

// Drives the watchdog interval and the page-lifecycle events by hand.
function harness() {
  const socket = fakeSocket();
  let tick: (() => void) | null = null;
  let intervalCleared = false;
  let visibilityHandler: ((visible: boolean) => void) | null = null;
  let onlineHandler: (() => void) | null = null;
  let visibilityDetached = false;
  let onlineDetached = false;
  let clock = 1_000_000;

  const store = createTerminalStore({
    socket,
    sessionFullName: "proj__a",
    sessionLabel: "a",
    now: () => clock,
    wait: () => Promise.resolve(),
    setIntervalFn: (callback) => {
      tick = callback;
      return "watchdog";
    },
    clearIntervalFn: (handle) => {
      expect(handle).toBe("watchdog");
      intervalCleared = true;
    },
    onVisibilityChange: (handler) => {
      visibilityHandler = handler;
      return () => {
        visibilityDetached = true;
      };
    },
    onOnline: (handler) => {
      onlineHandler = handler;
      return () => {
        onlineDetached = true;
      };
    },
  });

  return {
    socket,
    store,
    advance: (ms: number) => {
      clock += ms;
    },
    fireWatchdog: () => tick?.(),
    setVisible: (visible: boolean) => visibilityHandler?.(visible),
    fireOnline: () => onlineHandler?.(),
    get intervalCleared() {
      return intervalCleared;
    },
    get detached() {
      return visibilityDetached && onlineDetached;
    },
  };
}

// The server spawns every pty at 80x24 (src/main.ts) and TerminalView only
// reports a size when it changes -- which it does not across a reconnect,
// because the view is never remounted. Without replaying the size here the
// pane silently shrank to 80x24 on every reconnect.
describe("createTerminalStore size replay", () => {
  it("replays the last reported size whenever the socket opens", () => {
    const h = harness();

    h.store.onResize(120, 40);
    expect(h.socket.sendResize).toHaveBeenCalledWith(120, 40);

    h.socket.sendResize.mockClear();
    h.socket.emit("open");

    expect(h.socket.sendResize).toHaveBeenCalledWith(120, 40);
  });

  it("sends no resize on open before any size has been reported", () => {
    const h = harness();

    h.socket.emit("open");

    expect(h.socket.sendResize).not.toHaveBeenCalled();
  });
});

// A half-open socket still reports readyState OPEN, so `close` never fires
// and the ordinary backoff never starts. These cover the inference that
// replaces the ping/pong the browser will not give us.
describe("createTerminalStore staleness watchdog", () => {
  it("reconnects when a keystroke goes unanswered past the threshold", () => {
    const h = harness();
    h.socket.connect.mockClear();

    h.store.onInput("ls");
    h.advance(6000);
    h.fireWatchdog();

    expect(h.socket.connect).toHaveBeenCalledWith("proj__a", 0);
    expect(h.store.state.phase).toBe("reconnecting");
  });

  // Root-caused live: tmux sends attached clients only screen diffs, so a
  // keystroke that doesn't change the screen (quick-key ^C/^A/^E on an idle
  // prompt, ^C into a TUI that swallows it) legitimately draws ZERO reply
  // bytes. Arming the watchdog on that silence tore down healthy sockets:
  // tap ^C on an idle pane -> "Reconnecting…" banner 5s later.
  it("does not arm the watchdog for control-only input that legitimately draws no reply", () => {
    const h = harness();
    h.socket.connect.mockClear();

    h.store.onInput("\x03");
    h.advance(60_000);
    h.fireWatchdog();

    expect(h.socket.connect).not.toHaveBeenCalled();
    expect(h.store.state.phase).toBe("connected");
  });

  it("does not reconnect while the keystroke is still within the threshold", () => {
    const h = harness();
    h.socket.connect.mockClear();

    h.store.onInput("ls");
    h.advance(3000);
    h.fireWatchdog();

    expect(h.socket.connect).not.toHaveBeenCalled();
    expect(h.store.state.phase).toBe("connected");
  });

  it("does not reconnect when the server answered the keystroke", () => {
    const h = harness();
    h.socket.connect.mockClear();

    h.store.onInput("ls");
    h.advance(10);
    h.socket.emit("data", "ls\r\n");
    h.advance(60_000);
    h.fireWatchdog();

    expect(h.socket.connect).not.toHaveBeenCalled();
  });

  it("leaves an idle session alone no matter how long it stays silent", () => {
    const h = harness();
    h.socket.connect.mockClear();

    h.advance(3_600_000);
    h.fireWatchdog();

    expect(h.socket.connect).not.toHaveBeenCalled();
  });

  it("does not fire a second probe for the same unanswered keystroke", () => {
    const h = harness();
    h.socket.connect.mockClear();

    h.store.onInput("ls");
    h.advance(6000);
    h.fireWatchdog();
    h.socket.connect.mockClear();
    h.advance(6000);
    h.fireWatchdog();

    // Still "reconnecting" from the first probe -- the backoff owns it now.
    expect(h.socket.connect).not.toHaveBeenCalled();
  });
});

describe("createTerminalStore resume handling", () => {
  it("reconnects when the page returns after a long absence", () => {
    const h = harness();
    h.socket.connect.mockClear();

    h.setVisible(false);
    h.advance(120_000);
    h.setVisible(true);

    expect(h.socket.connect).toHaveBeenCalledWith("proj__a", 0);
  });

  it("does not reconnect after a brief tab switch", () => {
    const h = harness();
    h.socket.connect.mockClear();

    h.setVisible(false);
    h.advance(1500);
    h.setVisible(true);

    expect(h.socket.connect).not.toHaveBeenCalled();
    expect(h.store.state.phase).toBe("connected");
  });

  it("reconnects when the browser comes back online", () => {
    const h = harness();
    h.socket.connect.mockClear();

    h.fireOnline();

    expect(h.socket.connect).toHaveBeenCalledWith("proj__a", 0);
  });

  it("never reconnects a session tmux has already destroyed", async () => {
    const h = harness();
    h.socket.emit("close", SESSION_ENDED_CLOSE_CODE);
    await Promise.resolve();
    h.socket.connect.mockClear();

    h.fireOnline();
    h.setVisible(false);
    h.advance(120_000);
    h.setVisible(true);

    expect(h.socket.connect).not.toHaveBeenCalled();
    expect(h.store.state.phase).toBe("ended");
  });

  it("stops the watchdog and detaches lifecycle listeners on dispose", () => {
    const h = harness();

    h.store.dispose();

    expect(h.intervalCleared).toBe(true);
    expect(h.detached).toBe(true);

    h.socket.connect.mockClear();
    h.fireOnline();
    expect(h.socket.connect).not.toHaveBeenCalled();
  });
});
