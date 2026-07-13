// Pure decision logic for the terminal's manual Cmd+C copy handling. Kept
// DOM-free and dependency-free on purpose, same as notify.js: it is loaded
// both as a browser ES module (imported from app.js) and directly by
// Node's test runner (public/terminal-clipboard.test.js), with no build
// step in either direction.

export function isCopyShortcut(event) {
  return event.type === "keydown" && event.metaKey === true && String(event.key).toLowerCase() === "c";
}
