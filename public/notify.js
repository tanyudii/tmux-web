// Pure decision logic for the "developer isn't looking at this tab" bell
// alert. Kept DOM-free and dependency-free on purpose: it is loaded both as
// a browser ES module (imported from app.js) and directly by Node's test
// runner (public/notify.test.js), with no build step in either direction.

export function parseMuted(rawValue) {
  return rawValue === "true";
}

export function buildBellTitle(sessionName) {
  const label = sessionName ? sessionName : "session";
  return "\u{1F514} " + label + " needs you — tmux-web";
}

export function shouldPlayBellAlert({ muted, hasFocus, hidden, lastAlertAt, now, cooldownMs }) {
  if (muted) return false;

  const isAway = hidden || !hasFocus;
  if (!isAway) return false;

  if (lastAlertAt == null) return true;
  return now - lastAlertAt >= cooldownMs;
}
