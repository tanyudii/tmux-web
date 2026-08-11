import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { hideSearchBar, showSearchBar } from "./searchBarDom";

describe("showSearchBar / hideSearchBar", () => {
  let container: HTMLDivElement;
  let handlers: {
    onSearchInput: Mock<(term: string) => boolean>;
    onFindNext: Mock<(term: string) => boolean>;
    onFindPrevious: Mock<(term: string) => boolean>;
    onClose: Mock<() => void>;
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    handlers = {
      onSearchInput: vi.fn().mockReturnValue(true),
      onFindNext: vi.fn().mockReturnValue(true),
      onFindPrevious: vi.fn().mockReturnValue(true),
      onClose: vi.fn(),
    };
  });

  afterEach(() => {
    container.remove();
  });

  it("builds a search bar with a focused input", () => {
    showSearchBar(container, handlers);

    const input = container.querySelector("input");
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("calls onSearchInput as the user types", () => {
    showSearchBar(container, handlers);
    const input = container.querySelector("input") as HTMLInputElement;

    input.value = "foo";
    input.dispatchEvent(new Event("input"));

    expect(handlers.onSearchInput).toHaveBeenCalledWith("foo");
  });

  it("calls onFindNext on Enter and onFindPrevious on Shift+Enter", () => {
    showSearchBar(container, handlers);
    const input = container.querySelector("input") as HTMLInputElement;
    input.value = "foo";

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handlers.onFindNext).toHaveBeenCalledWith("foo");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    expect(handlers.onFindPrevious).toHaveBeenCalledWith("foo");
  });

  it("calls onClose on Escape", () => {
    showSearchBar(container, handlers);
    const input = container.querySelector("input") as HTMLInputElement;

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("wires the prev/next/close buttons", () => {
    showSearchBar(container, handlers);
    const input = container.querySelector("input") as HTMLInputElement;
    input.value = "bar";
    const buttons = container.querySelectorAll("button");

    buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(handlers.onFindPrevious).toHaveBeenCalledWith("bar");

    buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(handlers.onFindNext).toHaveBeenCalledWith("bar");

    buttons[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("marks the input as not-found when a search term has no match", () => {
    handlers.onSearchInput.mockReturnValue(false);
    showSearchBar(container, handlers);
    const input = container.querySelector("input") as HTMLInputElement;

    input.value = "missing";
    input.dispatchEvent(new Event("input"));

    // jsdom's CSSOM normalizes #F4685F to its rgb() equivalent.
    expect(input.style.borderColor).toContain("rgb(244, 104, 95)");
  });

  it("re-shows and refocuses the existing bar instead of building a duplicate", () => {
    showSearchBar(container, handlers);
    showSearchBar(container, handlers);

    expect(container.querySelectorAll(".tmux-search-bar").length).toBe(1);
  });

  it("hideSearchBar hides the bar without destroying it", () => {
    showSearchBar(container, handlers);

    hideSearchBar(container);

    const bar = container.querySelector(".tmux-search-bar") as HTMLElement;
    expect(bar.style.display).toBe("none");
  });

  it("hideSearchBar is a no-op when no bar exists yet", () => {
    expect(() => hideSearchBar(container)).not.toThrow();
  });
});
