import { cleanup, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalView } from "./TerminalView";
import type { FitAddonLike, SearchAddonLike, TerminalLike } from "./types";

// A fake standing in for @xterm/xterm's Terminal, which cannot run under
// jsdom (see xterm.ts's doc comment) -- this is the same DI seam as
// keydownHandlers.test.ts's fakeTerminal, reused here to drive the whole
// component without touching real xterm.js internals.
function fakeTerminal(overrides: Partial<TerminalLike> = {}): TerminalLike {
  let onDataCallback: ((data: string) => void) | null = null;
  let onBellCallback: (() => void) | null = null;
  return {
    cols: 80,
    rows: 24,
    options: { fontSize: 14 },
    open: vi.fn(),
    write: vi.fn(),
    onData: vi.fn((cb: (data: string) => void) => {
      onDataCallback = cb;
    }),
    onBell: vi.fn((cb: () => void) => {
      onBellCallback = cb;
    }),
    resize: vi.fn(),
    loadAddon: vi.fn(),
    dispose: vi.fn(),
    focus: vi.fn(),
    hasSelection: vi.fn().mockReturnValue(false),
    getSelection: vi.fn().mockReturnValue(""),
    clearSelection: vi.fn(),
    paste: vi.fn(),
    // Test-only escape hatches to fire the captured callbacks -- not part
    // of TerminalLike, so cast at the call site in tests.
    __fireData: (data: string) => onDataCallback?.(data),
    __fireBell: () => onBellCallback?.(),
    ...overrides,
  } as TerminalLike & { __fireData: (data: string) => void; __fireBell: () => void };
}

function fakeFitAddon(): FitAddonLike {
  return { fit: vi.fn() };
}

function fakeSearchAddon(): SearchAddonLike {
  return { findNext: vi.fn().mockReturnValue(true), findPrevious: vi.fn().mockReturnValue(true), clearActiveDecoration: vi.fn() };
}

describe("TerminalView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("mounts xterm into the container and reports readiness with a write/resize handle", () => {
    const terminal = fakeTerminal();
    const onReady = vi.fn();

    render(() => (
      <TerminalView
        onInput={vi.fn()}
        onBell={vi.fn()}
        onResize={vi.fn()}
        onReady={onReady}
        isVisible={true}
        onScroll={vi.fn()}
        captureSelection={() => Promise.resolve(null)}
        createTerminal={() => terminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    expect(terminal.open).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledOnce();
    const handle = onReady.mock.calls[0][0];
    handle.write("hello");
    expect(terminal.write).toHaveBeenCalledWith("hello");
    handle.resize(100, 40);
    expect(terminal.resize).toHaveBeenCalledWith(100, 40);
  });

  it("forwards keystrokes typed into xterm via onInput", () => {
    const terminal = fakeTerminal() as TerminalLike & { __fireData: (data: string) => void };
    const onInput = vi.fn();

    render(() => (
      <TerminalView
        onInput={onInput}
        onBell={vi.fn()}
        onResize={vi.fn()}
        onReady={vi.fn()}
        isVisible={true}
        onScroll={vi.fn()}
        captureSelection={() => Promise.resolve(null)}
        createTerminal={() => terminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    terminal.__fireData("ls -la\r");

    expect(onInput).toHaveBeenCalledWith("ls -la\r");
  });

  it("forwards the raw bell event without deciding whether to alert (that's the screen's job)", () => {
    const terminal = fakeTerminal() as TerminalLike & { __fireBell: () => void };
    const onBell = vi.fn();

    render(() => (
      <TerminalView
        onInput={vi.fn()}
        onBell={onBell}
        onResize={vi.fn()}
        onReady={vi.fn()}
        isVisible={true}
        onScroll={vi.fn()}
        captureSelection={() => Promise.resolve(null)}
        createTerminal={() => terminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    terminal.__fireBell();

    expect(onBell).toHaveBeenCalledOnce();
  });

  it("reports a resize once the deferred first fit settles the container's real size", () => {
    const terminal = fakeTerminal({ cols: 100, rows: 30 });
    const onResize = vi.fn();

    render(() => (
      <TerminalView
        onInput={vi.fn()}
        onBell={vi.fn()}
        onResize={onResize}
        onReady={vi.fn()}
        isVisible={true}
        onScroll={vi.fn()}
        captureSelection={() => Promise.resolve(null)}
        createTerminal={() => terminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    vi.runOnlyPendingTimers();

    expect(onResize).toHaveBeenCalledWith(100, 30);
  });

  it("hides the container and any open toast/search bar when isVisible becomes false", () => {
    const terminal = fakeTerminal();
    // Solid components run their body once; reactive prop changes are
    // driven by updating a signal, not by re-invoking render() with new
    // JSX (there is no RTL-style `rerender` in @solidjs/testing-library).
    const [isVisible, setIsVisible] = createSignal(true);
    const { container } = render(() => (
      <TerminalView
        onInput={vi.fn()}
        onBell={vi.fn()}
        onResize={vi.fn()}
        onReady={vi.fn()}
        isVisible={isVisible()}
        onScroll={vi.fn()}
        captureSelection={() => Promise.resolve(null)}
        createTerminal={() => terminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    setIsVisible(false);

    const root = container.firstElementChild as HTMLElement;
    expect(root.style.visibility).toBe("hidden");
  });

  // Integration-level counterpart to wheelScroll.test.ts: proves the wheel
  // path is actually wired into the rendered component and reaches
  // props.onScroll as tmux scroll lines. It CANNOT prove the xterm-side
  // consequence (that xterm no longer translates the wheel into arrow
  // keys) -- jsdom can't run real @xterm/xterm, so that half is covered by
  // the live WebSocket-frame check instead (see CLAUDE.md).
  it("turns a wheel gesture over the terminal into a tmux scroll, not terminal input", () => {
    const onScroll = vi.fn();
    const onInput = vi.fn();
    const terminal = fakeTerminal();
    const { container } = render(() => (
      <TerminalView
        onInput={onInput}
        onBell={vi.fn()}
        onResize={vi.fn()}
        onReady={vi.fn()}
        isVisible={true}
        onScroll={onScroll}
        captureSelection={() => Promise.resolve(null)}
        createTerminal={() => terminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));
    const root = container.firstElementChild as HTMLElement;
    // jsdom gives an unlaid-out element clientHeight 0, which would make
    // pixelsPerLine 0 and short-circuit accumulateScrollLines -- stub a real
    // height so the conversion runs.
    Object.defineProperty(root, "clientHeight", { value: 240, configurable: true });

    root.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true }));

    expect(onScroll).toHaveBeenCalledWith("up", expect.any(Number));
    expect(onInput).not.toHaveBeenCalled();
  });

  it("does not scroll on Ctrl+wheel (a Mac trackpad pinch) but still swallows the event", () => {
    const onScroll = vi.fn();
    const terminal = fakeTerminal();
    const { container } = render(() => (
      <TerminalView
        onInput={vi.fn()}
        onBell={vi.fn()}
        onResize={vi.fn()}
        onReady={vi.fn()}
        isVisible={true}
        onScroll={onScroll}
        captureSelection={() => Promise.resolve(null)}
        createTerminal={() => terminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));
    const root = container.firstElementChild as HTMLElement;
    Object.defineProperty(root, "clientHeight", { value: 240, configurable: true });

    const event = new WheelEvent("wheel", { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true });
    root.dispatchEvent(event);

    expect(onScroll).not.toHaveBeenCalled();
    // Still cancelled: handing it to xterm would reopen the arrow-key bug.
    expect(event.defaultPrevented).toBe(true);
  });

  it("restores focus to the terminal when it becomes visible again (dialog closed), but not on first mount", () => {
    const terminal = fakeTerminal();
    const [isVisible, setIsVisible] = createSignal(true);
    render(() => (
      <TerminalView
        onInput={vi.fn()}
        onBell={vi.fn()}
        onResize={vi.fn()}
        onReady={vi.fn()}
        isVisible={isVisible()}
        onScroll={vi.fn()}
        captureSelection={() => Promise.resolve(null)}
        createTerminal={() => terminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    // Mounting already-visible must not grab focus -- something else (a
    // still-open sheet's text field) may legitimately own it.
    expect(terminal.focus).not.toHaveBeenCalled();

    setIsVisible(false); // a dialog opens over the terminal
    setIsVisible(true); // ...and closes again

    expect(terminal.focus).toHaveBeenCalledOnce();
  });

  it("applies a Ctrl+= zoom by mutating the terminal's font size and re-fitting", () => {
    const fitAddon = fakeFitAddon();
    const terminal = fakeTerminal();
    const { container } = render(() => (
      <TerminalView
        onInput={vi.fn()}
        onBell={vi.fn()}
        onResize={vi.fn()}
        onReady={vi.fn()}
        isVisible={true}
        onScroll={vi.fn()}
        captureSelection={() => Promise.resolve(null)}
        createTerminal={() => terminal}
        createFitAddon={() => fitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));
    vi.clearAllTimers();

    const root = container.firstElementChild as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "+", ctrlKey: true, bubbles: true, cancelable: true }));

    expect(terminal.options.fontSize).toBe(15);
    expect(fitAddon.fit).toHaveBeenCalled();
  });

  it("turns a touch drag into an onScroll report using the container's real pixel height", () => {
    const terminal = fakeTerminal({ rows: 24 });
    const onScroll = vi.fn();
    const { container } = render(() => (
      <TerminalView
        onInput={vi.fn()}
        onBell={vi.fn()}
        onResize={vi.fn()}
        onReady={vi.fn()}
        isVisible={true}
        onScroll={onScroll}
        captureSelection={() => Promise.resolve(null)}
        createTerminal={() => terminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));
    const root = container.firstElementChild as HTMLElement;
    Object.defineProperty(root, "clientHeight", { value: 240, configurable: true });

    const start = new Event("touchstart");
    Object.defineProperty(start, "touches", { value: [{ clientY: 100 }] });
    root.dispatchEvent(start);
    // 240px / 24 rows = 10px/line; dragging the finger UP by 50px (i.e.
    // negative deltaY) scrolls DOWN into more recent output.
    const move = new Event("touchmove", { cancelable: true });
    Object.defineProperty(move, "touches", { value: [{ clientY: 50 }] });
    root.dispatchEvent(move);

    expect(onScroll).toHaveBeenCalledWith("down", 5);
  });

  it("opens the search bar on Ctrl+F", () => {
    const terminal = fakeTerminal();
    const { container } = render(() => (
      <TerminalView
        onInput={vi.fn()}
        onBell={vi.fn()}
        onResize={vi.fn()}
        onReady={vi.fn()}
        isVisible={true}
        onScroll={vi.fn()}
        captureSelection={() => Promise.resolve(null)}
        createTerminal={() => terminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    const root = container.firstElementChild as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));

    expect(root.querySelector(".tmux-search-bar")).not.toBeNull();
  });

  it("captures the selection after an Option-drag ends over the container", async () => {
    const terminal = fakeTerminal();
    const captureSelection = vi.fn().mockResolvedValue("tmux paste buffer text");
    const { container } = render(() => (
      <TerminalView
        onInput={vi.fn()}
        onBell={vi.fn()}
        onResize={vi.fn()}
        onReady={vi.fn()}
        isVisible={true}
        onScroll={vi.fn()}
        captureSelection={captureSelection}
        createTerminal={() => terminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));
    void container;

    document.dispatchEvent(new MouseEvent("mousedown", { altKey: true, clientX: 0, clientY: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 20, clientY: 20 }));
    await vi.runOnlyPendingTimersAsync();

    expect(captureSelection).toHaveBeenCalledOnce();
  });

  it("disposes the xterm instance on unmount", () => {
    const terminal = fakeTerminal();
    const { unmount } = render(() => (
      <TerminalView
        onInput={vi.fn()}
        onBell={vi.fn()}
        onResize={vi.fn()}
        onReady={vi.fn()}
        isVisible={true}
        onScroll={vi.fn()}
        captureSelection={() => Promise.resolve(null)}
        createTerminal={() => terminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    unmount();

    expect(terminal.dispose).toHaveBeenCalledOnce();
  });
});
