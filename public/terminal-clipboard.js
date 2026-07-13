// Pure decision logic for the terminal's manual Cmd+C copy handling. Kept
// DOM-free and dependency-free on purpose, same as notify.js: it is loaded
// both as a browser ES module (imported from app.js) and directly by
// Node's test runner (public/terminal-clipboard.test.js), with no build
// step in either direction.

export function isCopyShortcut(event) {
  return event.type === "keydown" && event.metaKey === true && String(event.key).toLowerCase() === "c";
}

// Insecure origins (plain HTTP on a non-localhost host, e.g. the
// Tailscale/WireGuard deployment this app recommends in its README) don't
// expose navigator.clipboard, and even the execCommand("copy") fallback can
// fail depending on the browser. The message tells the user which happened
// so a silent failure doesn't look identical to a silent success.
export function copyResultMessage(success) {
  return success ? "Copied" : "Auto-copy failed — press Cmd+C in the box below";
}
