// The xterm.js binding itself -- ports
// kmp/.../terminal/PlatformTerminalView.wasmJs.kt. Solid's component
// function body runs exactly ONCE per mount (unlike Compose, which
// recomposes on every state/prop change), so several Compose-specific
// workarounds in the original don't have an equivalent problem to work
// around here -- notably, there is no `update`-lambda-reruns-on-every-
// recomposition race, so ResizeObserver (plus one deferred first fit) is
// sufficient without also re-fitting synchronously on every reactive read.
//
// createTerminal/createFitAddon/createSearchAddon are injectable (default
// to the real @xterm/xterm factories in xterm.ts) because @xterm/xterm
// cannot run under jsdom -- confirmed empirically: `new Terminal().open(div)`
// throws "this._parentWindow.matchMedia is not a function" in vitest's
// jsdom environment. Tests inject a plain-object fake; real behavior can
// only be verified live in a real browser (see CLAUDE.md).
import { createEffect, onCleanup, onMount } from "solid-js";
import type { ScrollDirection } from "../api/terminalSocket";
import type { VirtualKeyName } from "../domain/virtualKeys";
import { pressVirtualKey } from "./virtualKeys";
import { accumulateScrollLines } from "../domain/terminalScroll";
import { attachTerminalKeydownListeners } from "./keydownHandlers";
import { copyTextToClipboard, hideCopyToast, showCopyToast } from "./clipboardDom";
import { applySelectionMode, clearContainerSelection, copySelectionToClipboard } from "./selectionMode";
import { hideSearchBar } from "./searchBarDom";
import { attachTouchScroll } from "./touchScroll";
import { attachWheelScroll } from "./wheelScroll";
import { dispatchWheelNotches } from "./syntheticWheel";
import { decodeOsc52, OSC_52_IDENT } from "./osc52";
import type { FitAddonLike, SearchAddonLike, TerminalLike } from "./types";
import { createXtermFitAddon, createXtermSearchAddon, createXtermTerminal } from "./xterm";
import { DEFAULT_FONT_SIZE } from "./zoom";

export interface TerminalHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  // Mobile clipboard surface (QuickKeysBar's Paste/Copy/Clear). These sit on
  // the handle rather than being driven by props because they are one-shot
  // commands, not state: the screen tells the terminal to do something at
  // the moment of a tap, and nothing about that outlives the tap.
  paste(data: string): void;
  copySelection(): Promise<boolean>;
  clearSelection(): void;
  // On-screen arrow pad. Deliberately takes a key NAME, not bytes: the
  // escape sequence for an arrow depends on the terminal's cursor key mode,
  // so xterm has to be the one to decide it (see terminal/virtualKeys.ts).
  pressKey(name: VirtualKeyName): void;
}

export interface TerminalViewProps {
  onInput: (data: string) => void;
  // Only forwards the raw bell event -- whether to actually flash/beep/
  // notify (respecting cooldown/away-detection, domain/bellAlert.ts) is the
  // screen/ViewModel layer's decision (Phase 6), same split as the
  // Kotlin original.
  onBell: () => void;
  onResize: (cols: number, rows: number) => void;
  onReady: (handle: TerminalHandle) => void;
  isVisible: boolean;
  // Driven by BOTH a finger drag (touchScroll.ts) and a wheel/trackpad
  // gesture (wheelScroll.ts). The wheel path used to be left to xterm.js on
  // the assumption it would forward SGR mouse escapes to tmux -- that only
  // holds with `mouse on`, and tmux defaults to `mouse off`, so on a
  // default install the wheel was instead translated by xterm into arrow
  // keys and came out as shell history. See wheelScroll.ts's header.
  onScroll: (direction: ScrollDirection, lines: number) => void;
  // Mobile "select text" mode. While true the browser gets the touch
  // gesture back (no preventDefault) and xterm's `user-select: none` is
  // overridden, so iOS can run its own long-press selection -- see
  // selectionMode.ts for why this has to be an explicit mode rather than
  // something always available.
  isSelecting?: boolean;
  createTerminal?: () => TerminalLike;
  createFitAddon?: () => FitAddonLike;
  createSearchAddon?: () => SearchAddonLike;
}

export function TerminalView(props: TerminalViewProps) {
  let container!: HTMLDivElement;
  let terminal: TerminalLike | null = null;
  let fitAddon: FitAddonLike | null = null;
  let searchAddon: SearchAddonLike | null = null;
  let fontSize = DEFAULT_FONT_SIZE;
  let lastCols = 0;
  let lastRows = 0;
  let touchScrollCarry = 0;
  let wheelScrollCarry = 0;
  let resizeObserver: ResizeObserver | undefined;
  let detachKeydown: (() => void) | undefined;
  let detachTouchScroll: (() => void) | undefined;
  let detachWheelScroll: (() => void) | undefined;

  const reportResizeIfChanged = (term: TerminalLike): void => {
    if (term.cols !== lastCols || term.rows !== lastRows) {
      lastCols = term.cols;
      lastRows = term.rows;
      props.onResize(term.cols, term.rows);
    }
  };

  const fitAndReport = (): void => {
    if (!terminal) return;
    fitAddon?.fit();
    reportResizeIfChanged(terminal);
  };

  onMount(() => {
    const createTerminal = props.createTerminal ?? createXtermTerminal;
    const createFit = props.createFitAddon ?? createXtermFitAddon;
    const createSearch = props.createSearchAddon ?? createXtermSearchAddon;

    const created = createTerminal();
    const addon = createFit();
    const search = createSearch();
    created.loadAddon(addon);
    created.loadAddon(search);
    created.open(container);
    created.onData((data) => props.onInput(data));
    created.onBell(() => props.onBell());

    // Copying from inside a full-screen app (Claude Code's own copy, vim's
    // "+y) reaches the terminal as OSC 52, which xterm.js parses but has no
    // handler for -- so it was silently dropped and nothing landed on the
    // clipboard. tmux forwards it here rather than keeping it (its
    // `set-clipboard` default is `external`), so this is the only place it
    // can be honoured. Returning true marks the sequence as handled.
    created.parser.registerOscHandler(OSC_52_IDENT, (payload) => {
      const text = decodeOsc52(payload);
      if (text === null) return true;
      void copyTextToClipboard(text).then((success) => {
        showCopyToast(container, success ? "Copied" : "Copy failed", success, success ? 1200 : 0);
      });
      return true;
    });

    terminal = created;
    fitAddon = addon;
    searchAddon = search;
    props.onReady({
      write: (data) => created.write(data),
      resize: (cols, rows) => created.resize(cols, rows),
      paste: (data) => created.paste(data),
      copySelection: () => copySelectionToClipboard(container),
      clearSelection: () => clearContainerSelection(container),
      pressKey: (name) => {
        pressVirtualKey(container, name);
      },
    });

    // FitAddon.fit() measures the container's current layout box. Calling
    // it synchronously right after open() races the browser's own layout
    // pass on the just-inserted <div> (often still 0x0 at this point),
    // rendering the terminal with 0 rows/cols -- invisible, no thrown
    // error. Deferring one animation frame lets layout settle first.
    requestAnimationFrame(() => {
      addon.fit();
      reportResizeIfChanged(created);
    });

    // A single deferred fit() only catches ONE late layout pass. The
    // container's real settled size can shift more than once after mount
    // (ancestor reflow, web font load, sidebar toggles) -- ResizeObserver
    // re-fits and re-reports on every real size change, not just the
    // first one.
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => fitAndReport());
      resizeObserver.observe(container);
    }

    detachKeydown = attachTerminalKeydownListeners(
      container,
      {
        terminal: () => terminal,
        searchAddon: () => searchAddon,
        fontSize: () => fontSize,
      },
      {
        onZoomApplied: (nextSize) => {
          fontSize = nextSize;
          if (terminal) terminal.options.fontSize = nextSize;
          fitAndReport();
        },
      },
    );

    // True while the foreground app asked for mouse events itself -- see
    // wheelScroll.ts. Such an app draws its own scrollable view and, on the
    // alternate screen, leaves tmux with no scrollback to offer, so the
    // gesture has to reach the app instead of tmux copy-mode.
    const usesAppMouse = (): boolean => terminal !== null && terminal.modes.mouseTrackingMode !== "none";

    // Folds a pixel delta (already in accumulateScrollLines' "positive =
    // down" convention) into whole scroll lines and hands them to [emit].
    // Touch and wheel keep SEPARATE carry accumulators: a wheel has no
    // gesture-start event to reset on, so sharing one let a leftover
    // sub-line fraction from one input device bias the first line count of
    // the other on a hybrid touchscreen+trackpad machine.
    const foldScrollPixels = (
      deltaPx: number,
      carry: number,
      setCarry: (next: number) => void,
      emit: (lines: number, pixelsPerLine: number) => void,
    ): void => {
      const rows = terminal?.rows ?? 0;
      const pixelsPerLine = rows > 0 ? container.clientHeight / rows : 0;
      const result = accumulateScrollLines(deltaPx, pixelsPerLine, carry);
      setCarry(result.carry);
      if (result.lines !== 0) emit(result.lines, pixelsPerLine);
    };

    const emitTmuxScroll = (lines: number): void => {
      const direction: ScrollDirection = lines < 0 ? "up" : "down";
      props.onScroll(direction, Math.abs(lines));
    };

    const reportScrollPixels = (deltaPx: number, carry: number, setCarry: (next: number) => void): void => {
      foldScrollPixels(deltaPx, carry, setCarry, (lines) => emitTmuxScroll(lines));
    };

    detachTouchScroll = attachTouchScroll(container, {
      // Selection mode and scrolling both want the single-finger drag; the
      // mode decides which one gets it (see selectionMode.ts).
      isEnabled: () => props.isSelecting !== true,
      onStart: () => {
        touchScrollCarry = 0;
      },
      // Dragging DOWN reveals earlier output -- i.e. scrolls UP into
      // history -- so the raw finger delta is negated into
      // accumulateScrollLines' "positive = down" convention.
      //
      // Unlike the wheel path, simply not intercepting is NOT an option
      // here: xterm.js does no touch->wheel translation, so letting the
      // touchmove through would scroll nothing and hand iOS its rubber-band
      // overscroll back. The gesture is manufactured into real wheel events
      // instead (syntheticWheel.ts), which xterm then encodes for the app.
      onDrag: (deltaY, point) =>
        foldScrollPixels(
          -deltaY,
          touchScrollCarry,
          (next) => (touchScrollCarry = next),
          (lines, pixelsPerLine) => {
            if (usesAppMouse()) {
              const perNotch = lines < 0 ? -pixelsPerLine : pixelsPerLine;
              // 0 means xterm has not rendered its screen element yet --
              // fall through rather than swallowing the gesture.
              if (dispatchWheelNotches(container, Math.abs(lines), perNotch, point) > 0) return;
            }
            emitTmuxScroll(lines);
          },
        ),
    });

    // A wheel's deltaY is already "positive = down", so unlike the touch
    // drag above it needs no negation. See wheelScroll.ts for why this is
    // handled here at all rather than left to xterm.js/tmux -- and why an
    // app that turned mouse tracking on is the one case we must NOT take it
    // from, which is what isEnabled below decides.
    detachWheelScroll = attachWheelScroll(container, {
      isEnabled: () => (terminal ? terminal.modes.mouseTrackingMode === "none" : true),
      onWheel: (deltaPx) => reportScrollPixels(deltaPx, wheelScrollCarry, (next) => (wheelScrollCarry = next)),
    });
  });

  onCleanup(() => {
    detachKeydown?.();
    detachTouchScroll?.();
    detachWheelScroll?.();
    resizeObserver?.disconnect();
    terminal?.dispose();
  });

  // visibility (not display:none) so the container keeps its real layout
  // box -- clientWidth/clientHeight (and therefore fit()) stay accurate
  // while hidden, instead of collapsing to 0x0 and needing a fresh fit()
  // once shown again.
  //
  // `wasVisible` tracks the previous value so focus is only restored on a
  // real hidden -> visible transition (a dialog/menu closing), never on
  // first mount: an unconditional focus() here would yank focus away from
  // whatever else legitimately has it while the terminal is merely
  // rendering behind an open sheet.
  createEffect(() => {
    applySelectionMode(container, props.isSelecting === true);
  });

  let wasVisible = props.isVisible;
  createEffect(() => {
    const visibility = props.isVisible ? "visible" : "hidden";
    container.style.visibility = visibility;
    // The parent that hosts this view can be its own hit-testable element
    // (e.g. a Popup/Dialog host) -- hide it too so it doesn't sit on top of
    // whatever is shown instead, swallowing clicks with no visible cause.
    if (container.parentElement) container.parentElement.style.visibility = visibility;
    if (!props.isVisible) {
      // A failure toast has no auto-dismiss timer, and an already-focused
      // search <input> is a real, independently-focusable element -- both
      // must not silently resurface/steal focus once this becomes visible
      // again for an unrelated reason (e.g. a dialog closing).
      hideCopyToast(container);
      hideSearchBar(container);
    } else {
      fitAndReport();
      // Hiding the container also blurs xterm's own hidden textarea, and
      // nothing gave it focus back -- so after closing the environment
      // menu (or any dialog that hides the terminal) keystrokes silently
      // went nowhere until the user clicked the terminal again.
      if (!wasVisible) terminal?.focus();
    }
    wasVisible = props.isVisible;
  });

  return <div ref={container} style={{ width: "100%", height: "100%", position: "relative" }} />;
}
