// DOM side of the on-screen arrow pad -- pure descriptors live in
// domain/virtualKeys.ts, same split as terminalClipboard.ts vs clipboardDom.ts.
//
// Unlike every other quick key, these do NOT go down the socket directly.
// They are dispatched into xterm's own hidden input, so xterm's keyboard
// handling runs exactly as it does for a hardware keyboard and picks the
// escape sequence that matches the terminal's current cursor key mode. The
// resulting bytes then reach the socket through the normal onData path, which
// also means they inherit the copy-mode snap-back the server does for any
// input (see src/pty-bridge.ts) -- pressing an arrow after scrolling up
// returns the pane to live output, just like typing does.
//
// Verified live in Chromium against a real tmux session: for all six keys the
// bytes produced this way are byte-for-byte identical to pressing the
// physical key.
import { VIRTUAL_KEYS, type VirtualKeyName } from "../domain/virtualKeys";

// xterm renders its own focus-holding textarea inside the container it was
// opened on. Targeting it (rather than the container) matters: xterm's
// keydown listener lives on the textarea, and dispatching one level up would
// never reach it.
const XTERM_TEXTAREA_SELECTOR = ".xterm-helper-textarea";

/** Returns false when xterm has not rendered its input yet (terminal still mounting). */
export function pressVirtualKey(container: HTMLElement, name: VirtualKeyName): boolean {
  const textarea = container.querySelector<HTMLTextAreaElement>(XTERM_TEXTAREA_SELECTOR);
  if (!textarea) return false;

  const descriptor = VIRTUAL_KEYS[name];
  textarea.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: descriptor.key,
      code: descriptor.code,
      // `keyCode`/`which` are legacy and absent from the KeyboardEventInit
      // spec, but xterm's key evaluation still reads keyCode, and browsers
      // still honour them here. Omitting them yields a dead button.
      keyCode: descriptor.keyCode,
      which: descriptor.keyCode,
      shiftKey: descriptor.shiftKey,
      bubbles: true,
      cancelable: true,
    } as KeyboardEventInit),
  );
  return true;
}
