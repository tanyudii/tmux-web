// Wires the terminal container's keydown-driven shortcuts (search, copy,
// zoom) -- ports kmp/.../terminal/TerminalKeydownHandlers.wasmJs.kt. Pure
// shortcut-detection lives in domain/terminalClipboard.ts and
// domain/terminalSearch.ts (Phase 3); this module is the DOM wiring on top.
//
// Search and copy MUST run in the CAPTURE phase: xterm.js's own internal
// keydown handler (on its hidden textarea, the real event *target*) treats
// Ctrl+F as the VT control character ^F and Ctrl+C as SIGINT, and
// stopPropagation()s before a bubble-phase listener on `container` would
// ever see it (Cmd+F/Cmd+C worked fine, since metaKey isn't in xterm's
// Ctrl-letter VT keymap). A capture-phase listener on the container is the
// only way to intercept ahead of xterm's own handling. Zoom has no such
// race (Ctrl/Cmd +/-/0 aren't in xterm's keymap either) so it stays on a
// bubble-phase listener.
import { COPY_NO_SELECTION_MESSAGE, copyResultMessage, isCopyShortcut } from "../domain/terminalClipboard";
import { isFindShortcut } from "../domain/terminalSearch";
import { copyTextToClipboard, showCopyToast } from "./clipboardDom";
import { hideSearchBar, showSearchBar } from "./searchBarDom";
import type { SearchAddonLike, TerminalLike } from "./types";
import { nextZoomFontSize } from "./zoom";

const COPY_TOAST_DURATION_MS = 1800;
const NO_SELECTION_TOAST_DURATION_MS = 3200;

export interface TerminalKeydownState {
  terminal: () => TerminalLike | null;
  searchAddon: () => SearchAddonLike | null;
  fontSize: () => number;
  takeCapturedSelectionText: () => string | null;
}

export interface TerminalKeydownCallbacks {
  onZoomApplied: (nextSize: number) => void;
}

function openTerminalSearchBar(
  container: HTMLElement,
  searchAddon: () => SearchAddonLike | null,
  terminal: () => TerminalLike | null,
): void {
  showSearchBar(container, {
    onSearchInput: (term) => searchAddon()?.findNext(term) ?? false,
    onFindNext: (term) => searchAddon()?.findNext(term) ?? false,
    onFindPrevious: (term) => searchAddon()?.findPrevious(term) ?? false,
    onClose: () => {
      hideSearchBar(container);
      searchAddon()?.clearActiveDecoration();
      terminal()?.focus();
    },
  });
}

function performCopy(term: TerminalLike, text: string, container: HTMLElement): void {
  void copyTextToClipboard(text).then((success) => {
    const durationMs = success ? COPY_TOAST_DURATION_MS : 0;
    showCopyToast(container, copyResultMessage(success), success, durationMs);
    // execCommand's scratch textarea (see clipboardDom.ts) takes focus away
    // from xterm's own hidden input; move it back so keystrokes keep
    // reaching the shell, win or lose.
    term.focus();
  });
}

/**
 * Cmd+C is the Mac copy shortcut, but xterm's own hidden input textarea can
 * end up being what the browser's native copy command targets, so the
 * selected terminal text doesn't reliably reach the clipboard -- handle it
 * ourselves whenever there's an active selection. Ctrl+C is also recognized
 * (see isCopyShortcut's doc comment) but only claimed when there's
 * something to copy; with nothing to copy it's left alone so it still sends
 * SIGINT to the shell, matching every other terminal.
 *
 * `takeCapturedSelectionText` is the fallback source when xterm has no
 * local selection of its own: an Option-drag no longer produces one (see
 * optionDrag.ts) -- instead it's relayed from tmux's own paste buffer and
 * cached by the caller right after the drag ends.
 */
function handleCopyKeyDown(keyEvent: KeyboardEvent, terminal: TerminalLike | null, state: TerminalKeydownState, container: HTMLElement): void {
  const isCopy = isCopyShortcut({
    type: keyEvent.type,
    metaKey: keyEvent.metaKey,
    ctrlKey: keyEvent.ctrlKey,
    shiftKey: keyEvent.shiftKey,
    key: keyEvent.key,
  });
  if (!terminal || !isCopy) return;

  const selectionText = terminal.hasSelection() ? terminal.getSelection() : state.takeCapturedSelectionText();
  if (selectionText !== null) {
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    performCopy(terminal, selectionText, container);
    return;
  }
  // Only Cmd+C gets the hint: Ctrl+C is also the shell's interrupt signal,
  // and most Ctrl+C presses have nothing selected on purpose (the user just
  // wants to send SIGINT) -- hinting there would spam a toast on every
  // routine interrupt. Crucially this does NOT stopPropagation: the event
  // must keep flowing to xterm's textarea so Ctrl+C still sends SIGINT.
  if (keyEvent.metaKey) {
    showCopyToast(container, COPY_NO_SELECTION_MESSAGE, false, NO_SELECTION_TOAST_DURATION_MS);
  }
}

function handleSearchKeyDown(keyEvent: KeyboardEvent, onOpenSearch: () => void): boolean {
  const isFind = isFindShortcut({
    type: keyEvent.type,
    ctrlKey: keyEvent.ctrlKey,
    metaKey: keyEvent.metaKey,
    key: keyEvent.key,
  });
  if (!isFind) return false;
  keyEvent.preventDefault();
  onOpenSearch();
  return true;
}

/** Ctrl/Cmd +/-/0 zoom. preventDefault() also stops the browser's own page-zoom from firing on the same keystroke. */
function handleZoomKeyDown(keyEvent: KeyboardEvent, hasTerminal: boolean, fontSize: number, onZoomApplied: (nextSize: number) => void): void {
  const isZoomModifier = keyEvent.ctrlKey || keyEvent.metaKey;
  const nextSize = isZoomModifier ? nextZoomFontSize(keyEvent.key, fontSize) : null;
  if (nextSize === null) return;
  keyEvent.preventDefault();
  if (nextSize !== fontSize && hasTerminal) onZoomApplied(nextSize);
}

/** Returns a cleanup function that detaches both listeners. */
export function attachTerminalKeydownListeners(
  container: HTMLElement,
  state: TerminalKeydownState,
  callbacks: TerminalKeydownCallbacks,
): () => void {
  const onCaptureKeyDown = (event: Event): void => {
    const keyEvent = event as KeyboardEvent;
    if (handleSearchKeyDown(keyEvent, () => openTerminalSearchBar(container, state.searchAddon, state.terminal))) {
      keyEvent.stopPropagation();
      return;
    }
    handleCopyKeyDown(keyEvent, state.terminal(), state, container);
  };

  const onBubbleKeyDown = (event: Event): void => {
    const keyEvent = event as KeyboardEvent;
    handleZoomKeyDown(keyEvent, state.terminal() !== null, state.fontSize(), callbacks.onZoomApplied);
  };

  container.addEventListener("keydown", onCaptureKeyDown, true);
  container.addEventListener("keydown", onBubbleKeyDown);

  return () => {
    container.removeEventListener("keydown", onCaptureKeyDown, true);
    container.removeEventListener("keydown", onBubbleKeyDown);
  };
}
