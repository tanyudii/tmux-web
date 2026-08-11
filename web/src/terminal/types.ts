// Shared DI-testable interfaces for the terminal binding. Narrow enough
// that @xterm/xterm's real Terminal/FitAddon/SearchAddon satisfy them (see
// xterm.ts's construction adapter), and narrow enough that tests can supply
// plain-object fakes -- @xterm/xterm needs a real browser Canvas/matchMedia
// and cannot run under jsdom (confirmed empirically while building Phase 4;
// `new Terminal().open(div)` throws "this._parentWindow.matchMedia is not a
// function" under vitest's jsdom environment).
export interface TerminalLike {
  readonly cols: number;
  readonly rows: number;
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
