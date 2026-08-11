// DOM side of the mobile "select text" mode. The pure part (cleaning up
// what the browser hands back) lives in domain/domSelection.ts, same split
// as terminalClipboard.ts vs clipboardDom.ts.
//
// Why a mode at all, rather than always-on selection: this app deliberately
// takes touch gestures away from the browser. touchScroll.ts owns the
// single-finger drag and preventDefault()s it, because the real scrollback
// lives in tmux rather than in xterm (see touchScroll.ts's header). iOS
// drives long-press selection and its drag handles through those same
// touchmove events, so scroll and select cannot both own the gesture --
// only an explicit mode makes which one is active predictable to the user.
//
// The class hangs on the container rather than on `.xterm` itself because
// TerminalView owns the container; xterm owns everything below it and
// rebuilds those nodes as it renders.
import { normalizeSelectedTerminalText } from "../domain/domSelection";
import { TOUCH_COPY_NO_SELECTION_MESSAGE, copyResultMessage } from "../domain/terminalClipboard";
import {
  COPY_TOAST_DURATION_MS,
  NO_SELECTION_TOAST_DURATION_MS,
  copyTextToClipboard,
  showCopyToast,
} from "./clipboardDom";

export const SELECTION_MODE_CLASS = "tw-terminal--selecting";

export function applySelectionMode(container: HTMLElement, isSelecting: boolean): void {
  container.classList.toggle(SELECTION_MODE_CLASS, isSelecting);
}

/**
 * The browser-native selection currently sitting inside `container`, or null
 * when there is none (or when it lies entirely outside the terminal -- e.g.
 * the user selected something in a dialog while the mode was still on).
 */
export function readContainerSelection(container: HTMLElement): string | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const anchor = selection.anchorNode;
  if (anchor === null || !container.contains(anchor)) return null;
  return selection.toString();
}

/** Drops the current selection, so "Clear" visibly does something and Done leaves no stray highlight. */
export function clearContainerSelection(container: HTMLElement): void {
  if (readContainerSelection(container) === null) return;
  window.getSelection()?.removeAllRanges();
}

/**
 * Copies whatever the user has selected inside the terminal, reporting the
 * outcome through the same toast the desktop Cmd+C path uses.
 *
 * Note this never touches navigator.clipboard's *read* side, so it works on
 * the insecure-origin (plain-HTTP tunnel) deployments this app recommends --
 * see CLAUDE.md. The write side degrades to execCommand("copy"), which
 * browsers still permit there, and clipboardDom.ts's implementation of that
 * fallback is the iOS-safe one.
 */
export async function copySelectionToClipboard(container: HTMLElement): Promise<boolean> {
  const raw = readContainerSelection(container);
  const text = raw === null ? null : normalizeSelectedTerminalText(raw);
  if (text === null) {
    showCopyToast(container, TOUCH_COPY_NO_SELECTION_MESSAGE, false, NO_SELECTION_TOAST_DURATION_MS);
    return false;
  }

  const copied = await copyTextToClipboard(text);
  // A failure toast is left up indefinitely (durationMs 0), same rule as the
  // Cmd+C path: on a phone the user may well be looking away mid-gesture,
  // and a silently vanished failure is indistinguishable from a success.
  showCopyToast(container, copyResultMessage(copied), copied, copied ? COPY_TOAST_DURATION_MS : 0);
  return copied;
}
