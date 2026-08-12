import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as clipboardDom from "./clipboardDom";
import { attachTerminalKeydownListeners } from "./keydownHandlers";
import type { SearchAddonLike, TerminalLike } from "./types";

function keydown(
  key: string,
  options: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
}

function fakeTerminal(overrides: Partial<TerminalLike> = {}): TerminalLike {
  return {
    cols: 80,
    rows: 24,
    modes: { mouseTrackingMode: "none" as const },
    parser: { registerOscHandler: vi.fn() },
    options: { fontSize: 14 },
    open: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    onBell: vi.fn(),
    resize: vi.fn(),
    loadAddon: vi.fn(),
    dispose: vi.fn(),
    focus: vi.fn(),
    hasSelection: vi.fn().mockReturnValue(false),
    getSelection: vi.fn().mockReturnValue(""),
    clearSelection: vi.fn(),
    paste: vi.fn(),
    ...overrides,
  };
}

function fakeSearchAddon(overrides: Partial<SearchAddonLike> = {}): SearchAddonLike {
  return {
    findNext: vi.fn().mockReturnValue(true),
    findPrevious: vi.fn().mockReturnValue(true),
    clearActiveDecoration: vi.fn(),
    ...overrides,
  };
}

describe("attachTerminalKeydownListeners", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it("opens the search bar on Ctrl+F and stops it from reaching xterm's own handler", () => {
    const terminal = fakeTerminal();
    const searchAddon = fakeSearchAddon();
    attachTerminalKeydownListeners(
      container,
      { terminal: () => terminal, searchAddon: () => searchAddon, fontSize: () => 14},
      { onZoomApplied: vi.fn() },
    );

    container.dispatchEvent(keydown("f", { ctrlKey: true }));

    expect(container.querySelector(".tmux-search-bar")).not.toBeNull();
  });

  it("copies the active selection on Cmd+C and refocuses the terminal", async () => {
    vi.spyOn(clipboardDom, "copyTextToClipboard").mockResolvedValue(true);
    const terminal = fakeTerminal({ hasSelection: vi.fn().mockReturnValue(true), getSelection: vi.fn().mockReturnValue("selected text") });
    attachTerminalKeydownListeners(
      container,
      { terminal: () => terminal, searchAddon: () => null, fontSize: () => 14},
      { onZoomApplied: vi.fn() },
    );

    container.dispatchEvent(keydown("c", { metaKey: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(clipboardDom.copyTextToClipboard).toHaveBeenCalledWith("selected text");
    expect(terminal.focus).toHaveBeenCalled();
  });

  it("shows a no-selection hint for Cmd+C with nothing to copy, without claiming the event", () => {
    const showToast = vi.spyOn(clipboardDom, "showCopyToast");
    const terminal = fakeTerminal({ hasSelection: vi.fn().mockReturnValue(false) });
    attachTerminalKeydownListeners(
      container,
      { terminal: () => terminal, searchAddon: () => null, fontSize: () => 14},
      { onZoomApplied: vi.fn() },
    );

    container.dispatchEvent(keydown("c", { metaKey: true }));

    expect(showToast).toHaveBeenCalled();
  });

  it("leaves a plain Ctrl+C with nothing selected alone so it still sends SIGINT", () => {
    const showToast = vi.spyOn(clipboardDom, "showCopyToast");
    const copy = vi.spyOn(clipboardDom, "copyTextToClipboard");
    const terminal = fakeTerminal({ hasSelection: vi.fn().mockReturnValue(false) });
    attachTerminalKeydownListeners(
      container,
      { terminal: () => terminal, searchAddon: () => null, fontSize: () => 14},
      { onZoomApplied: vi.fn() },
    );

    container.dispatchEvent(keydown("c", { ctrlKey: true }));

    expect(showToast).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it("applies a zoom shortcut and prevents the browser's own page-zoom", () => {
    const onZoomApplied = vi.fn();
    const terminal = fakeTerminal();
    attachTerminalKeydownListeners(
      container,
      { terminal: () => terminal, searchAddon: () => null, fontSize: () => 14},
      { onZoomApplied },
    );

    const event = keydown("+", { ctrlKey: true });
    const preventDefault = vi.spyOn(event, "preventDefault");
    container.dispatchEvent(event);

    expect(onZoomApplied).toHaveBeenCalledWith(15);
    expect(preventDefault).toHaveBeenCalled();
  });

  it("does not apply zoom when there is no terminal mounted yet", () => {
    const onZoomApplied = vi.fn();
    attachTerminalKeydownListeners(
      container,
      { terminal: () => null, searchAddon: () => null, fontSize: () => 14},
      { onZoomApplied },
    );

    container.dispatchEvent(keydown("+", { ctrlKey: true }));

    expect(onZoomApplied).not.toHaveBeenCalled();
  });

  it("the returned cleanup function detaches both the capture and bubble listeners", () => {
    const onZoomApplied = vi.fn();
    const terminal = fakeTerminal();
    const detach = attachTerminalKeydownListeners(
      container,
      { terminal: () => terminal, searchAddon: () => null, fontSize: () => 14},
      { onZoomApplied },
    );

    detach();
    container.dispatchEvent(keydown("+", { ctrlKey: true }));

    expect(onZoomApplied).not.toHaveBeenCalled();
  });
});
