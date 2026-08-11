// Key descriptors for the on-screen arrow pad (QuickKeysBar's arrow mode),
// which exists so a phone with no hardware keyboard can drive a TUI's
// selection menus -- Claude Code's choice prompts being the motivating case.
//
// These are KeyboardEvent shapes, NOT escape sequences, and that is the whole
// point. The other quick keys (Esc, Tab, ^C...) push raw bytes straight down
// the socket, which is fine for them because their byte form is fixed. Arrows
// are not fixed: they have two wire forms depending on the terminal's cursor
// key mode (DECCKM) --
//   normal mode      ESC [ A
//   application mode ESC O A
// -- and sending the wrong one is a SILENT failure, where the app simply
// ignores the key. Rather than guess the mode, these descriptors are
// dispatched into xterm's own keyboard handler (terminal/virtualKeys.ts) and
// xterm decides the bytes, exactly as it does for a hardware keyboard.
//
// Measured live in Chromium against a real tmux session: a synthetic event
// built from each descriptor below emits byte-for-byte what pressing the
// physical key emits, for all six keys. (Observed there: tmux pins the outer
// terminal to application mode and translates for the inner app itself, so
// the terminal emitted ESC O A even at a plain bash prompt -- a hardcoded
// ESC [ A would not have matched what a real keystroke produces.)
//
// keyCode is included because xterm's own key evaluation still reads the
// legacy `keyCode` property, not just `key`.
export type VirtualKeyName = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Enter" | "ShiftTab";

export interface VirtualKeyDescriptor {
  key: string;
  code: string;
  keyCode: number;
  shiftKey: boolean;
}

export const VIRTUAL_KEYS: Readonly<Record<VirtualKeyName, VirtualKeyDescriptor>> = {
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38, shiftKey: false },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40, shiftKey: false },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, shiftKey: false },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39, shiftKey: false },
  Enter: { key: "Enter", code: "Enter", keyCode: 13, shiftKey: false },
  // Shift+Tab is a real chord, not a key of its own: it is Tab with the
  // shift modifier, and xterm turns that into ESC [ Z (CSI Z, back-tab).
  // Claude Code uses it to cycle modes, which is why it earns a spot on a
  // bar this cramped.
  ShiftTab: { key: "Tab", code: "Tab", keyCode: 9, shiftKey: true },
};

export function virtualKeyDescriptor(name: VirtualKeyName): VirtualKeyDescriptor {
  return VIRTUAL_KEYS[name];
}
