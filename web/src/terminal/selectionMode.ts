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
 * when none of it does (e.g. the user selected something in a dialog while
 * the mode was still on).
 *
 * A selection that only PARTLY overlaps the terminal is clipped to the part
 * inside it rather than taken whole. This is not hypothetical on a phone: the
 * quick-keys bar sits directly below the terminal, so dragging a selection
 * handle past the bottom edge extends the selection into the bar's own button
 * labels. Testing `container.contains(anchorNode)` alone -- as this did
 * originally -- passes such a selection straight through, and the user's
 * clipboard silently gains "CopyClearDone" on the end of their command output.
 *
 * NOTE this NARROWS the live selection as a side effect when clipping applies
 * (see the body for why that is required, not merely convenient).
 *
 * The rendered-text half of that reasoning cannot be unit tested here: jsdom
 * implements Selection.toString() as plain Range.toString(), so both include
 * non-rendered <style> text and the distinction this function depends on does
 * not exist under jsdom. Verified in a real browser instead -- see the
 * live-verification note in CLAUDE.md for why that is the standard here.
 */
export function readContainerSelection(container: HTMLElement): string | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const clipped = clipRangeToContainer(selection.getRangeAt(0), container);
  if (clipped === null || clipped.collapsed) return null;

  // Narrow the LIVE selection to the clipped range and read it back through
  // Selection rather than returning `clipped.toString()` directly. Two
  // reasons, the first found the hard way in a browser:
  //
  //  1. Range.toString() concatenates every text node between its endpoints,
  //     including ones that are never rendered. xterm injects <style>
  //     elements inside this container, so a clipped range that reaches past
  //     the rows picked up raw CSS ("...ider.active { background: #ffffff80 }")
  //     and put it on the clipboard. Selection.toString() is defined in terms
  //     of rendered text and skips them.
  //  2. The highlight the user is looking at then matches what was actually
  //     copied, instead of silently copying less than what looks selected.
  selection.removeAllRanges();
  selection.addRange(clipped);
  return selection.toString();
}

/**
 * Narrows `range` so neither end lies outside `container`, or returns null
 * when the two do not overlap at all.
 *
 * Only range 0 is considered. Multi-range selections are a Firefox-only
 * capability (Chrome and Safari collapse to a single range), and this whole
 * module exists for a touch gesture on mobile Safari.
 */
function clipRangeToContainer(range: Range, container: HTMLElement): Range | null {
  const bounds = container.ownerDocument.createRange();
  bounds.selectNodeContents(container);

  // Entirely before or entirely after the container -- no overlap to clip to.
  if (range.compareBoundaryPoints(Range.END_TO_START, bounds) >= 0) return null;
  if (range.compareBoundaryPoints(Range.START_TO_END, bounds) <= 0) return null;

  const clipped = range.cloneRange();
  if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) {
    clipped.setStart(bounds.startContainer, bounds.startOffset);
  }
  if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) {
    clipped.setEnd(bounds.endContainer, bounds.endOffset);
  }
  return clipped;
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
