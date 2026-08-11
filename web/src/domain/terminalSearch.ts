// Ports kmp/composeApp/.../domain/TerminalSearch.kt (EMB-219): whether a
// keydown is the "open terminal search" shortcut. DOM-free like
// terminalClipboard.ts's isCopyShortcut so it stays testable in isolation.
// Ctrl+F is included alongside Cmd+F (unlike isCopyShortcut, which only
// checks metaKey) because Ctrl+F has no existing meaning to a shell/tmux --
// intercepting it is safe on every platform, not just macOS.
export interface FindShortcutInput {
  type: string;
  ctrlKey: boolean;
  metaKey: boolean;
  key: string;
}

export function isFindShortcut(input: FindShortcutInput): boolean {
  return input.type === "keydown" && (input.ctrlKey || input.metaKey) && input.key.toLowerCase() === "f";
}
