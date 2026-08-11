// "Find on screen" overlay -- ports kmp/.../terminal/XtermJs.kt's
// showSearchBar/hideSearchBar. A real DOM element appended to `container`,
// not a framework-rendered node: xterm.js's own canvas/DOM paints over
// anything layered the normal way in the same stacking context (see
// TerminalView.tsx's isVisible handling for the same class of issue).
//
// Search only ever covers xterm's own JS-side buffer, which only ever holds
// the currently-rendered screen for this app: tmux repaints panes via ANSI
// cursor positioning rather than emitting real newlines, so xterm never
// accumulates genuine scrollback rows to search beyond what's on screen
// right now. The input's title says so rather than silently implying
// full-history search.
export interface SearchBarHandlers {
  onSearchInput: (term: string) => boolean;
  onFindNext: (term: string) => boolean;
  onFindPrevious: (term: string) => boolean;
  onClose: () => void;
}

const BAR_CLASS = "tmux-search-bar";

function markFound(input: HTMLInputElement, found: boolean): void {
  input.style.borderColor = input.value && !found ? "#F4685F" : "transparent";
}

function makeButton(label: string, title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  Object.assign(button.style, {
    background: "transparent",
    border: "none",
    color: "#9AA4B2",
    cursor: "pointer",
    fontSize: "13px",
    padding: "2px 4px",
  });
  return button;
}

function buildSearchBar(container: HTMLElement, handlers: SearchBarHandlers): void {
  const bar = document.createElement("div");
  bar.className = BAR_CLASS;
  Object.assign(bar.style, {
    position: "absolute",
    top: "8px",
    right: "16px",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 6px",
    borderRadius: "8px",
    background: "#1B212C",
    border: "1px solid #2A3140",
    zIndex: "20",
    fontFamily: "sans-serif",
  });

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Find on screen";
  input.title = "Searches only the currently visible screen, not scrollback history";
  Object.assign(input.style, {
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: "4px",
    outline: "none",
    color: "#E6E9EF",
    fontSize: "13px",
    fontFamily: "inherit",
    width: "160px",
    padding: "2px 4px",
  });

  const prevButton = makeButton("↑", "Previous match (Shift+Enter)");
  const nextButton = makeButton("↓", "Next match (Enter)");
  const closeButton = makeButton("✕", "Close (Esc)");

  input.addEventListener("input", () => markFound(input, handlers.onSearchInput(input.value)));
  input.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key === "Enter") {
      keyEvent.preventDefault();
      markFound(input, keyEvent.shiftKey ? handlers.onFindPrevious(input.value) : handlers.onFindNext(input.value));
    } else if (keyEvent.key === "Escape") {
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      handlers.onClose();
    }
  });
  prevButton.addEventListener("click", () => markFound(input, handlers.onFindPrevious(input.value)));
  nextButton.addEventListener("click", () => markFound(input, handlers.onFindNext(input.value)));
  closeButton.addEventListener("click", () => handlers.onClose());

  bar.appendChild(input);
  bar.appendChild(prevButton);
  bar.appendChild(nextButton);
  bar.appendChild(closeButton);
  container.appendChild(bar);
  input.focus();
}

/** Reopening while already open just re-shows and refocuses/reselects it rather than rebuilding. */
export function showSearchBar(container: HTMLElement, handlers: SearchBarHandlers): void {
  const existing = container.querySelector<HTMLElement>(`.${BAR_CLASS}`);
  if (existing) {
    existing.style.display = "flex";
    const input = existing.querySelector("input");
    input?.focus();
    input?.select();
    return;
  }
  buildSearchBar(container, handlers);
}

/** Hides the search bar without destroying it, so reopening restores its last search term. */
export function hideSearchBar(container: HTMLElement): void {
  const bar = container.querySelector<HTMLElement>(`.${BAR_CLASS}`);
  if (bar) bar.style.display = "none";
}
