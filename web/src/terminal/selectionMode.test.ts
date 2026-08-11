import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SELECTION_MODE_CLASS,
  applySelectionMode,
  clearContainerSelection,
  copySelectionToClipboard,
  readContainerSelection,
} from "./selectionMode";

describe("applySelectionMode", () => {
  it("adds the class when turning selection mode on", () => {
    const container = document.createElement("div");

    applySelectionMode(container, true);

    expect(container.classList.contains(SELECTION_MODE_CLASS)).toBe(true);
  });

  it("removes the class when turning selection mode off", () => {
    const container = document.createElement("div");
    applySelectionMode(container, true);

    applySelectionMode(container, false);

    expect(container.classList.contains(SELECTION_MODE_CLASS)).toBe(false);
  });

  it("is idempotent", () => {
    const container = document.createElement("div");

    applySelectionMode(container, true);
    applySelectionMode(container, true);

    expect(container.className).toBe(SELECTION_MODE_CLASS);
  });
});

describe("readContainerSelection / clearContainerSelection", () => {
  let container: HTMLDivElement;
  let outside: HTMLDivElement;
  // Document order matters for the clipping tests: a DOM Range is always
  // normalized to start-before-end, so "selection starts outside" can only be
  // built from an element that PRECEDES the container.
  let before: HTMLDivElement;

  function selectContentsOf(element: Node): void {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  beforeEach(() => {
    container = document.createElement("div");
    container.textContent = "npm run build";
    outside = document.createElement("div");
    outside.textContent = "unrelated dialog text";
    before = document.createElement("div");
    before.textContent = "nav bar above";
    document.body.append(before, container, outside);
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    container.remove();
    outside.remove();
    before.remove();
  });

  it("returns null when nothing is selected", () => {
    expect(readContainerSelection(container)).toBeNull();
  });

  it("returns the selected text when the selection is inside the container", () => {
    selectContentsOf(container);

    expect(readContainerSelection(container)).toBe("npm run build");
  });

  it("returns null when the selection lies entirely before the container", () => {
    selectContentsOf(before);

    expect(readContainerSelection(container)).toBeNull();
  });

  it("returns null when the selection lies outside the container", () => {
    // The mode can still be on while a dialog is open; copying whatever the
    // user happened to select in there would be wrong.
    selectContentsOf(outside);

    expect(readContainerSelection(container)).toBeNull();
  });

  // The quick-keys bar sits directly below the terminal on a phone, so
  // dragging a selection handle past the bottom edge really does extend the
  // selection into it. Only the terminal's share may be copied.
  it("clips a selection that starts inside the container and ends outside it", () => {
    const range = document.createRange();
    range.setStart(container.firstChild as Node, 0);
    range.setEnd(outside.firstChild as Node, "unrelated".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(readContainerSelection(container)).toBe("npm run build");
  });

  it("clips a selection that starts outside the container and ends inside it", () => {
    const range = document.createRange();
    range.setStart(before.firstChild as Node, 0);
    range.setEnd(container.firstChild as Node, "npm run".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(readContainerSelection(container)).toBe("npm run");
  });

  it("clearContainerSelection drops a selection inside the container", () => {
    selectContentsOf(container);

    clearContainerSelection(container);

    expect(readContainerSelection(container)).toBeNull();
  });

  it("clearContainerSelection leaves a selection outside the container alone", () => {
    selectContentsOf(outside);

    clearContainerSelection(container);

    expect(window.getSelection()?.toString()).toBe("unrelated dialog text");
  });
});


// The whole point of the feature: read the selection, normalize it, put it on
// the clipboard, and say so. Previously only the no-selection branch was
// covered, so a regression in any of those four steps shipped green.
describe("copySelectionToClipboard", () => {
  let container: HTMLDivElement;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    container = document.createElement("div");
    // Trailing padding spaces and a blank tail row, exactly as xterm's DOM
    // renderer produces them (see domain/domSelection.ts).
    container.textContent = "git status   \n \n";
    document.body.appendChild(container);
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
    window.getSelection()?.removeAllRanges();
    container.remove();
    vi.useRealTimers();
  });

  function selectAll(): void {
    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  it("puts the NORMALIZED selection on the clipboard, not the raw padded text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    selectAll();

    const copied = await copySelectionToClipboard(container);

    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("git status");
  });

  it("reports success through the toast", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    selectAll();

    await copySelectionToClipboard(container);

    expect(container.querySelector(".tmux-copy-toast")?.textContent).toBe("Copied");
  });

  it("auto-dismisses the success toast but leaves a failure toast up", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    selectAll();
    await copySelectionToClipboard(container);
    const toast = container.querySelector(".tmux-copy-toast") as HTMLElement;

    vi.advanceTimersByTime(1800);
    expect(toast.style.display).toBe("none");

    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);
    selectAll();
    await copySelectionToClipboard(container);

    vi.advanceTimersByTime(60_000);
    // A failure the user may have looked away from must not vanish.
    expect(toast.style.display).toBe("block");
    expect(toast.textContent).toContain("Auto-copy failed");
  });

  it("reports a failed copy as failure, not success", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);
    selectAll();

    expect(await copySelectionToClipboard(container)).toBe(false);
  });

  it("says nothing was selected rather than copying an empty string", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const copied = await copySelectionToClipboard(container);

    expect(copied).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(container.querySelector(".tmux-copy-toast")?.textContent).toContain("Nothing selected");
  });
});
