import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SELECTION_MODE_CLASS,
  applySelectionMode,
  clearContainerSelection,
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
    document.body.append(container, outside);
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    container.remove();
    outside.remove();
  });

  it("returns null when nothing is selected", () => {
    expect(readContainerSelection(container)).toBeNull();
  });

  it("returns the selected text when the selection is inside the container", () => {
    selectContentsOf(container);

    expect(readContainerSelection(container)).toBe("npm run build");
  });

  it("returns null when the selection lies outside the container", () => {
    // The mode can still be on while a dialog is open; copying whatever the
    // user happened to select in there would be wrong.
    selectContentsOf(outside);

    expect(readContainerSelection(container)).toBeNull();
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
