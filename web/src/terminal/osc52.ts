// OSC 52 -- the escape sequence an application uses to put text on the
// terminal's clipboard ("\x1b]52;c;<base64>\x07").
//
// WHY THIS EXISTS: copying from inside a full-screen app (Claude Code's own
// copy action, vim's `"+y`, lazygit, ...) never reached the system
// clipboard. Traced live on this server: tmux's `set-clipboard` is at its
// default `external`, which means tmux does NOT keep the payload for itself
// -- it forwards the OSC 52 straight out to whatever terminal is attached.
// That terminal is xterm.js here, and xterm.js implements no OSC 52 handler
// of its own, so the sequence was parsed and silently dropped. The app
// believed it had copied; nothing had.
//
// Handling it here also covers the case tmux copy-mode used to cover badly:
// the app knows exactly what the user selected, so nothing depends on tmux
// mouse bindings or on relaying a paste buffer that may be stale.

/** OSC identifier for the clipboard-set sequence. */
export const OSC_52_IDENT = 52;

/**
 * Decodes an OSC 52 payload (everything after `52;`) into the text the app
 * wants on the clipboard.
 *
 * Returns null -- meaning "do nothing" -- for anything that is not a
 * straightforward clipboard SET:
 *
 * - A READ request (`c;?`). Answering it would hand the page's clipboard
 *   contents to any process running in the terminal, which is a real
 *   exfiltration channel and exactly why most terminals keep OSC 52 reads
 *   disabled. This never responds.
 * - Malformed or non-base64 data, which must not throw inside xterm's
 *   parser.
 *
 * The leading field is the selection target (`c` clipboard, `p` primary,
 * `s`, or several at once). They are all treated as "the clipboard" because
 * a browser only has the one.
 */
export function decodeOsc52(payload: string): string | null {
  const separator = payload.indexOf(";");
  if (separator === -1) return null;

  const encoded = payload.slice(separator + 1);
  if (encoded === "" || encoded === "?") return null;

  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    // OSC 52 payloads are UTF-8; atob alone would mangle anything non-ASCII
    // (an accented word, a box-drawing character) into mojibake.
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
