// Ports kmp/.../ui/components/TmuxCommandPalette.kt -- Ctrl+K/Cmd+K command
// palette (EMB-218/#18g). This component only owns the search/filter/
// keyboard-nav *within* an already-open palette; WebShellScreen.tsx owns
// the global Ctrl+K listener that opens it (see that file's header comment
// for why a real-DOM app needs an explicit "don't fire while the terminal
// has focus" guard that Compose never needed).
import { createEffect, createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { buildCommandPaletteItems, filterAndRankItems, type CommandPaletteItem } from "../domain/commandPalette";
import type { Project, ProjectSession } from "../api/types";

export interface CommandPaletteProps {
  projects: Project[];
  sessionsByProjectId: Record<string, ProjectSession[]>;
  onSelect: (item: CommandPaletteItem) => void;
  onDismiss: () => void;
}

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 4.5a1 1 0 011-1h3.2l1 1.2H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4.5z"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2" />
      <path d="M4 6l2.5 2-2.5 2M8 10h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.3" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

export function CommandPalette(props: CommandPaletteProps) {
  let inputRef: HTMLInputElement | undefined;
  const listboxId = createUniqueId();
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const items = createMemo(() => buildCommandPaletteItems(props.projects, props.sessionsByProjectId));
  const filtered = createMemo(() => filterAndRankItems(items(), query()));
  const activeItemId = createMemo(() => filtered()[selectedIndex()]?.id);

  createEffect(() => {
    if (selectedIndex() >= filtered().length) setSelectedIndex(0);
  });

  createEffect(() => {
    inputRef?.focus();
  });

  function moveSelection(delta: number): void {
    const count = filtered().length;
    if (count === 0) return;
    setSelectedIndex((index) => (index + delta + count) % count);
  }

  function selectAtIndex(index: number): void {
    const item = filtered()[index];
    if (item) props.onSelect(item);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        props.onDismiss();
        break;
      case "ArrowDown":
        event.preventDefault();
        moveSelection(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveSelection(-1);
        break;
      case "Enter":
        event.preventDefault();
        selectAtIndex(selectedIndex());
        break;
      default:
        break;
    }
  }

  return (
    <div class="tw-sheet-scrim tw-command-palette-scrim" onClick={() => props.onDismiss()}>
      <div class="tw-command-palette" onClick={(event) => event.stopPropagation()}>
        <div class="tw-command-palette__search-row">
          <span class="tw-command-palette__search-icon">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            class="tw-command-palette__input"
            type="text"
            placeholder="Search projects and sessions…"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            aria-label="Search projects and sessions"
            role="combobox"
            aria-expanded={filtered().length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeItemId()}
          />
        </div>
        <div class="tw-command-palette__divider" />
        <Show
          when={filtered().length > 0}
          fallback={<p class="tw-command-palette__empty">No matches</p>}
        >
          <div class="tw-command-palette__results" role="listbox" id={listboxId}>
            <For each={filtered()}>
              {(item, index) => (
                <div
                  id={item.id}
                  role="option"
                  aria-selected={index() === selectedIndex()}
                  class="tw-command-palette__row"
                  classList={{ "tw-command-palette__row--selected": index() === selectedIndex() }}
                  onMouseEnter={() => setSelectedIndex(index())}
                  onClick={() => props.onSelect(item)}
                >
                  <span class="tw-command-palette__row-icon">
                    {item.kind === "project" ? <FolderIcon /> : <TerminalIcon />}
                  </span>
                  <span class="tw-command-palette__row-labels">
                    <span class="tw-command-palette__row-label">{item.label}</span>
                    <Show when={item.sublabel}>
                      <span class="tw-command-palette__row-sublabel">{item.sublabel}</span>
                    </Show>
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
