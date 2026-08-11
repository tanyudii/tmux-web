// Real @xterm/xterm construction, adapted to the DI-testable interfaces in
// types.ts -- ports kmp/.../terminal/XtermJs.kt's newTerminal()/
// newFitAddon()/newSearchAddon(). No custom bindings/UMD script tags needed
// here (unlike the KMP/wasmJs original): @xterm/xterm ships real TS types
// as an npm package.
//
// The `as unknown as` casts below are a deliberate DI seam, same pattern as
// api/client.test.ts's `fetchImpl as unknown as typeof fetch`: the real
// Terminal/FitAddon/SearchAddon classes structurally satisfy TerminalLike/
// FitAddonLike/SearchAddonLike, but proving that to the type checker isn't
// worth fighting method-parameter variance for an adapter that has no logic
// of its own and (per Phase 4's Terminal-under-jsdom finding) can only ever
// be verified against a real browser anyway.
//
// fontSize pinned explicitly (matches DEFAULT_FONT_SIZE in zoom.ts) rather
// than left at xterm.js's own built-in default, so Ctrl+0 "reset zoom" has
// a known, exact value to reset to. rightClickSelectsWord: false -- xterm.js
// defaults this to true on macOS, which replaces an existing multi-line
// selection with a single word on right-click.
//
// macOptionClickForcesSelection is deliberately left at its default
// (false): a plain drag (with or without Option/Alt on Mac, Shift
// elsewhere) is left to fall through to tmux's own mouse-reporting when
// tmux.conf has `mouse on`, entering tmux's native copy-mode -- which
// already auto-scrolls correctly at the pane edges, unlike xterm.js's own
// local-selection auto-scroll, which drives a local scrollback buffer that
// stays effectively empty in this app (see touchScroll.ts). Instead,
// Option-drag is tracked separately (optionDrag.ts) purely to know when to
// relay tmux's own resulting paste buffer to the real OS clipboard on
// Cmd+C (see keydownHandlers.ts).
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import type { FitAddonLike, SearchAddonLike, TerminalLike } from "./types";
import { DEFAULT_FONT_SIZE } from "./zoom";

export function createXtermTerminal(): TerminalLike {
  return new Terminal({
    cursorBlink: true,
    fontFamily: "monospace",
    fontSize: DEFAULT_FONT_SIZE,
    // No bellStyle option here: unlike the vendored xterm.js build the KMP
    // client used, @xterm/xterm@6's ITerminalOptions dropped the built-in
    // audio/visual bell entirely -- `onBell` is the only surface left, and
    // this app was already routing bell handling exclusively through it
    // (bellFeedback.ts), so there is nothing left to silence.
    rightClickSelectsWord: false,
    // Reclaims the terminal's full width and removes xterm's own scrollbar.
    //
    // Measured live at a 393px-wide iPhone viewport: `.xterm-screen` rendered
    // only 371px, leaving a 22px dead strip down the right edge. 14px of that
    // is a scrollbar gutter and 8px is the leftover that cannot fit another
    // 8.43px character cell. The 14px is NOT reclaimable with CSS -- the fit
    // addon does not measure the scrollbar, it subtracts a constant:
    //
    //   scrollbarWidth = options.scrollback === 0
    //     ? 0
    //     : (options.overviewRuler?.width || DEFAULT_SCROLL_BAR_WIDTH /* 14 */)
    //
    // (verified by reading @xterm/addon-fit's own proposeDimensions(), and
    // confirmed empirically: hiding the scrollbar via CSS zeroed the scrollbar
    // element's width but left the 22px gap exactly as it was). Note
    // `overviewRuler: { width: 0 }` cannot work either -- 0 is falsy, so the
    // `||` falls through to the 14px default. `scrollback: 0` is the only
    // branch that yields 0.
    //
    // Turning scrollback off costs nothing here, which is why this is a fix
    // rather than a trade: tmux always runs in the terminal's ALTERNATE screen
    // buffer, and the alternate buffer has no scrollback by definition -- so
    // xterm's scrollback was never being populated in the first place.
    // Scrolling in this app does not go through xterm at all; wheelScroll.ts
    // and touchScroll.ts translate the gesture into an explicit `scroll`
    // message that drives tmux copy-mode. Scrolling therefore still works
    // exactly as before, and it is tmux's scrollback -- the real one -- being
    // scrolled.
    scrollback: 0,
  }) as unknown as TerminalLike;
}

export function createXtermFitAddon(): FitAddonLike {
  return new FitAddon() as unknown as FitAddonLike;
}

export function createXtermSearchAddon(): SearchAddonLike {
  return new SearchAddon() as unknown as SearchAddonLike;
}
