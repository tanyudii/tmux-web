// Shared DI-testable interfaces for the terminal binding. Narrow enough
// that @xterm/xterm's real Terminal/FitAddon/SearchAddon satisfy them (see
// xterm.ts's construction adapter), and narrow enough that tests can supply
// plain-object fakes -- @xterm/xterm needs a real browser Canvas/matchMedia
// and cannot run under jsdom (confirmed empirically while building Phase 4;
// `new Terminal().open(div)` throws "this._parentWindow.matchMedia is not a
// function" under vitest's jsdom environment).
/**
 * Mouse-tracking mode the *foreground application* has asked for, as xterm.js
 * reports it (`CSI ? 9/1000/1002/1003 h`). tmux runs with `mouse off` by
 * default and this project never changes that, so tmux passes the inner
 * pane app's mouse-mode escapes straight through to this terminal -- which
 * makes this the one reliable client-side signal for "the running app wants
 * the wheel itself". See wheelScroll.ts for what depends on it.
 */
export type MouseTrackingMode = "none" | "x10" | "vt200" | "drag" | "any";

export interface TerminalLike {
  readonly cols: number;
  readonly rows: number;
  readonly modes: { readonly mouseTrackingMode: MouseTrackingMode };
  // OSC handler registration -- used for OSC 52 (clipboard set) so a copy
  // performed INSIDE the running app reaches the system clipboard instead
  // of being parsed and dropped. See osc52.ts.
  readonly parser: { registerOscHandler(ident: number, handler: (data: string) => boolean): void };
  // xterm.js exposes font size as a mutable property on `.options`, not a
  // setter method -- matches terminal.options.fontSize = size in
  // kmp/.../terminal/XtermJs.kt's setFontSize.
  options: { fontSize: number };
  open(container: HTMLElement): void;
  write(data: string): void;
  onData(callback: (data: string) => void): void;
  onBell(callback: () => void): void;
  resize(cols: number, rows: number): void;
  loadAddon(addon: unknown): void;
  dispose(): void;
  focus(): void;
  // Selection/clipboard surface -- see terminalKeydown.ts's Cmd+C handling.
  hasSelection(): boolean;
  getSelection(): string;
  clearSelection(): void;
  // Mobile paste (PasteSheet) routes through xterm's own paste() rather
  // than pushing the text straight down the socket as input. xterm is what
  // knows whether the running app has requested bracketed-paste mode, and
  // wraps the payload in \x1b[200~ ... \x1b[201~ accordingly -- without
  // that, a multi-line paste into a shell executes every line the instant
  // it arrives instead of landing as one editable block. It also
  // normalizes \r\n / \n to \r, which is what a terminal expects.
  paste(data: string): void;
}

export interface FitAddonLike {
  fit(): void;
}

// EMB-219: findNext/findPrevious always select+scroll the match themselves
// (xterm's own SearchAddon source calls `_terminal.select(...)`
// unconditionally), so a found match is already visibly highlighted via
// xterm's normal selection styling with no extra decoration options needed.
export interface SearchAddonLike {
  findNext(term: string): boolean;
  findPrevious(term: string): boolean;
  clearActiveDecoration(): void;
}
