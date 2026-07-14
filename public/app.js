// Vanilla JS, no build step. Keep this file small enough to read in one
// sitting -- that's the whole point of a self-audited tool.
//
// Loaded as an ES module (see index.html) purely so it can import the
// DOM-free decision logic in notify.js -- still zero bundler, zero
// transpile step, just a native <script type="module">.

import { parseMuted, buildBellTitle, shouldPlayBellAlert } from "./notify.js";
import { isCopyShortcut, copyResultMessage } from "./terminal-clipboard.js";

const TOKEN_KEY = "tmux-web-token";
const NOTIFY_MUTE_KEY = "tmux-web-notify-muted";
const BELL_COOLDOWN_MS = 1500;
const COPY_TOAST_DURATION_MS = 1800;
// Rough cross-browser heuristic for how many wheel pixels make up one
// terminal line (browsers report wildly different deltaY magnitudes for the
// same physical scroll gesture) -- not exact line metrics, just enough to
// keep a single wheel "notch" mapping to a small, sane number of lines.
const SCROLL_PIXELS_PER_LINE = 34;

const loginForm = document.getElementById("login");
const tokenInput = document.getElementById("token");
const loginError = document.getElementById("login-error");
const appEl = document.getElementById("app");

const projectListView = document.getElementById("project-list-view");
const projectListEl = document.getElementById("project-list");
const emptyProjectsEl = document.getElementById("empty-projects");
const addProjectBtn = document.getElementById("add-project");

const projectDetailView = document.getElementById("project-detail-view");
const backToProjectsBtn = document.getElementById("back-to-projects");
const projectDetailTitle = document.getElementById("project-detail-title");
const sessionListEl = document.getElementById("session-list");
const newSessionBtn = document.getElementById("new-session");
const newSessionSpinner = document.getElementById("new-session-spinner");
const newSessionLabel = document.getElementById("new-session-label");
const newSessionHint = document.getElementById("new-session-hint");
const terminalEl = document.getElementById("terminal");
const emptyStateEl = document.getElementById("empty-state");
const copyToastEl = document.getElementById("copy-toast");
const copyFallbackEl = document.getElementById("copy-fallback");
const copyFallbackInputEl = document.getElementById("copy-fallback-input");
const copyFallbackCloseBtn = document.getElementById("copy-fallback-close");

const changesSidebar = document.getElementById("changes-sidebar");
const changesBodyEl = document.getElementById("changes-body");
const toggleChangesBtn = document.getElementById("toggle-changes");
const toggleNotifyBtn = document.getElementById("toggle-notify");

const envBar = document.getElementById("env-bar");
const envStatusBadge = document.getElementById("env-status-badge");
const envMessageEl = document.getElementById("env-message");
const envSetupBtn = document.getElementById("env-setup-btn");
const envLogsBtn = document.getElementById("env-logs-btn");
const envStopBtn = document.getElementById("env-stop-btn");
const envOpenLink = document.getElementById("env-open-link");

const logsModal = document.getElementById("logs-modal");
const logsServiceSelect = document.getElementById("logs-service-select");
const logsCloseBtn = document.getElementById("logs-close-btn");
const logsTerminalEl = document.getElementById("logs-terminal");

let token = sessionStorage.getItem(TOKEN_KEY) || "";
let currentProject = null; // { id, name, repoPath, createdAt }
let activeSessionName = null; // display name (slug), not the full tmux name
let socket = null;
let term = null;
let fitAddon = null;
let sessionPollTimer = null;
let changesPollTimer = null;
let envPollTimer = null;
let isCreatingSession = false;
let expandedDiffKey = null; // "mode:path" of the single currently-open inline diff, or null
let logsSocket = null;
let logsTerm = null;
let logsFitAddon = null;
let terminalWheelHandler = null;
let wheelLineAccumulator = 0;

// --- Bell notifications (sound + title flash when this tab isn't the one
// the developer is looking at) --------------------------------------------
// Claude Code rings the terminal BEL character for its Notification (needs
// permission/asks a question) and Stop (task done) events when configured
// with `preferredNotifChannel: terminal_bell` -- see README. xterm.js
// already parses BEL out of the raw PTY stream (pty-bridge.ts forwards
// bytes unmodified) and exposes it as term.onBell(), so this is the one
// generic hook that covers "question", "confirm", "done", and anything
// else in the session that rings the bell.
let notifyMuted = parseMuted(localStorage.getItem(NOTIFY_MUTE_KEY));
let lastBellAlertAt = null;
let audioCtx = null;
let titleFlashed = false;
const baseTitle = document.title;

function updateNotifyButton() {
  toggleNotifyBtn.textContent = notifyMuted ? "\u{1F515}" : "\u{1F514}";
  toggleNotifyBtn.title = notifyMuted
    ? "Bell notifications muted -- click to enable"
    : "Bell notifications enabled -- click to mute";
}

toggleNotifyBtn.addEventListener("click", () => {
  notifyMuted = !notifyMuted;
  localStorage.setItem(NOTIFY_MUTE_KEY, String(notifyMuted));
  updateNotifyButton();
  if (!notifyMuted && typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission();
  }
});
updateNotifyButton();

// AudioContext (and some browsers' Notification permission) requires a
// prior user gesture -- unlock it on the first click anywhere in the app,
// well before any bell could plausibly fire.
document.addEventListener(
  "click",
  () => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioCtx) audioCtx = new AudioCtx();
    else if (audioCtx.state === "suspended") audioCtx.resume();
  },
  { once: true },
);

function playBellBeep() {
  if (!audioCtx) return;
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
  oscillator.connect(gain);
  gain.connect(audioCtx.destination);
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 0.3);
}

function restoreTitle() {
  if (!titleFlashed) return;
  document.title = baseTitle;
  titleFlashed = false;
}

window.addEventListener("focus", restoreTitle);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) restoreTitle();
});

function handleBell() {
  if (notifyMuted) return;

  document.title = buildBellTitle(activeSessionName);
  titleFlashed = true;

  const now = Date.now();
  const shouldAlert = shouldPlayBellAlert({
    muted: notifyMuted,
    hasFocus: document.hasFocus(),
    hidden: document.hidden,
    lastAlertAt: lastBellAlertAt,
    now,
    cooldownMs: BELL_COOLDOWN_MS,
  });
  if (!shouldAlert) return;

  lastBellAlertAt = now;
  playBellBeep();

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    const notification = new Notification("tmux-web", {
      body: (activeSessionName || "A session") + " needs your attention",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}

function apiFetch(path, options) {
  const headers = Object.assign({}, (options && options.headers) || {}, {
    Authorization: "Bearer " + token,
  });
  return fetch(path, Object.assign({}, options, { headers }));
}

async function tryLogin(candidateToken) {
  const res = await fetch("/api/projects", { headers: { Authorization: "Bearer " + candidateToken } });
  return res.status === 200;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const candidate = tokenInput.value.trim();
  if (!candidate) return;

  const ok = await tryLogin(candidate);
  if (!ok) {
    loginError.textContent = "Invalid token.";
    return;
  }

  token = candidate;
  sessionStorage.setItem(TOKEN_KEY, token);
  enterApp();
});

function enterApp() {
  loginForm.style.display = "none";
  appEl.style.display = "flex";
  showProjectList();
}

// --- Project list screen ---

function showProjectList() {
  stopSessionPolling();
  detachTerminal();
  currentProject = null;
  projectDetailView.style.display = "none";
  projectListView.style.display = "block";
  refreshProjects();
}

async function refreshProjects() {
  const res = await apiFetch("/api/projects");
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    location.reload();
    return;
  }
  const body = await res.json();
  renderProjectList(body.projects);
}

function renderProjectList(projects) {
  projectListEl.textContent = "";
  emptyProjectsEl.style.display = projects.length === 0 ? "block" : "none";

  for (const project of projects) {
    const item = document.createElement("div");
    item.className = "project-item";

    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "project-name";
    name.textContent = project.name;
    const path = document.createElement("div");
    path.className = "project-path";
    path.textContent = project.repoPath;
    info.appendChild(name);
    info.appendChild(path);

    const killBtn = document.createElement("button");
    killBtn.className = "kill";
    killBtn.textContent = "×";
    killBtn.title = "Remove project";
    killBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      removeProject(project);
    });

    item.appendChild(info);
    item.appendChild(killBtn);
    item.addEventListener("click", () => openProject(project));
    projectListEl.appendChild(item);
  }
}

addProjectBtn.addEventListener("click", async () => {
  const name = window.prompt("Project name:");
  if (!name) return;
  const repoPath = window.prompt("Absolute path to the git repo on this server:");
  if (!repoPath) return;

  const res = await apiFetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, repoPath }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    window.alert("Could not add project: " + (body.error || res.status));
    return;
  }
  await refreshProjects();
});

async function removeProject(project) {
  if (!window.confirm('Remove project "' + project.name + '" from tmux-web?\n\n(This only unregisters it here -- it does not delete the git repo.)')) {
    return;
  }

  const res = await apiFetch("/api/projects/" + encodeURIComponent(project.id), { method: "DELETE" });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    const retry = window.confirm(
      (body.error || "Project has active sessions") +
        ".\n\nRemove anyway? Its tmux sessions will keep running outside tmux-web.",
    );
    if (!retry) return;
    await apiFetch("/api/projects/" + encodeURIComponent(project.id) + "?force=true", { method: "DELETE" });
  }
  await refreshProjects();
}

// --- Project detail (sessions) screen ---

function openProject(project) {
  currentProject = project;
  projectDetailTitle.textContent = project.name;
  projectListView.style.display = "none";
  projectDetailView.style.display = "flex";
  refreshSessions();
  sessionPollTimer = setInterval(refreshSessions, 4000);
}

backToProjectsBtn.addEventListener("click", showProjectList);

function stopSessionPolling() {
  if (sessionPollTimer) clearInterval(sessionPollTimer);
  sessionPollTimer = null;
}

function projectSessionsUrl(suffix) {
  return "/api/projects/" + encodeURIComponent(currentProject.id) + "/sessions" + (suffix || "");
}

async function refreshSessions() {
  if (!currentProject) return;
  const res = await apiFetch(projectSessionsUrl(""));
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    location.reload();
    return;
  }
  const body = await res.json();
  renderSessionList(body.sessions);
}

function renderSessionList(sessions) {
  sessionListEl.textContent = "";
  for (const session of sessions) {
    const item = document.createElement("div");
    item.className = "session-item" + (session.name === activeSessionName ? " active" : "");
    item.dataset.name = session.name;

    const label = document.createElement("span");
    label.textContent = session.name + " (" + session.windows + (session.attached ? ", attached" : "") + ")";
    label.addEventListener("click", () => attachToSession(session));

    const killBtn = document.createElement("button");
    killBtn.className = "kill";
    killBtn.textContent = "×";
    killBtn.title = "Kill session";
    killBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      killSession(session.name);
    });

    item.appendChild(label);
    item.appendChild(killBtn);
    sessionListEl.appendChild(item);
  }
}

// Creating a session runs `git fetch origin` + `git worktree add` on the
// server before it responds (see worktree.ts) -- on a large repo or slow
// connection that can take several seconds, so this button needs its own
// pending state or it just looks stuck for a while.
function setNewSessionPending(pending) {
  newSessionBtn.disabled = pending;
  newSessionSpinner.hidden = !pending;
  newSessionLabel.textContent = pending ? "Creating…" : "+ New session";
  newSessionHint.hidden = !pending;
}

newSessionBtn.addEventListener("click", async () => {
  if (isCreatingSession) return;
  const name = window.prompt("New session name (becomes a git branch + worktree):");
  if (!name) return;

  isCreatingSession = true;
  setNewSessionPending(true);
  try {
    const res = await apiFetch(projectSessionsUrl(""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      window.alert("Could not create session: " + (body.error || res.status));
      return;
    }
    const session = await res.json();
    await refreshSessions();
    attachToSession(session);
  } finally {
    isCreatingSession = false;
    setNewSessionPending(false);
  }
});

async function killSession(name) {
  if (!window.confirm('Kill session "' + name + '" and remove its worktree? This ends every process running inside it.')) {
    return;
  }

  let res = await apiFetch(projectSessionsUrl("/" + encodeURIComponent(name)), { method: "DELETE" });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    const retry = window.confirm(
      (body.error || "The worktree has uncommitted changes") + ".\n\nForce-delete and lose those changes?",
    );
    if (!retry) return;
    res = await apiFetch(projectSessionsUrl("/" + encodeURIComponent(name) + "?force=true"), { method: "DELETE" });
  }

  if (name === activeSessionName) detachTerminal();
  await refreshSessions();
}

function attachToSession(session) {
  if (session.name === activeSessionName && socket) return;
  detachTerminal();
  activeSessionName = session.name;
  emptyStateEl.style.display = "none";

  term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    bellStyle: "none",
    // macOS defaults this to true, which replaces a multi-line selection
    // with a single-word selection on right-click -- exactly the "my
    // selection disappears" complaint this app should not reproduce.
    rightClickSelectsWord: false,
    // A shell program that enables mouse mode (e.g. tmux with `set -g
    // mouse on`) makes xterm.js forward every click-drag to the PTY
    // instead of selecting locally -- the drag becomes a tmux copy-mode
    // selection into tmux's own buffer, invisible to the browser and
    // never reaching this app's Cmd+C handler. xterm.js's built-in
    // override for this is Shift+drag on Windows/Linux, but on macOS it's
    // Option+drag -- and only if this option is explicitly turned on
    // (defaults to false upstream). Without it, macOS users had no way to
    // select text locally at all while mouse mode was active.
    macOptionClickForcesSelection: true,
  });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminalEl);
  fitAddon.fit();
  term.onBell(() => handleBell());
  term.attachCustomKeyEventHandler((event) => handleTerminalKeyEvent(term, event));

  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url =
    wsProtocol + "//" + location.host + "/ws?session=" + encodeURIComponent(session.fullName) + "&token=" + encodeURIComponent(token);
  socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    sendResize();
  });

  socket.addEventListener("message", (event) => {
    term.write(event.data);
  });

  socket.addEventListener("close", () => {
    if (term) term.write("\r\n\x1b[90m[disconnected — click the session again to reattach]\x1b[0m\r\n");
  });

  term.onData((data) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
    }
  });

  wheelLineAccumulator = 0;
  terminalWheelHandler = handleTerminalWheel;
  // Captured on #terminal (an ancestor of whatever xterm.js attaches its own
  // wheel listener to) so this fires first and stopPropagation() keeps
  // xterm's own handling -- native viewport scrollback, or forwarding the
  // wheel as mouse-mode escapes -- from ever running. tmux's own copy-mode
  // scrollback (driven server-side, see pty-bridge.ts) replaces both: it
  // works the same way whether or not the user's tmux.conf has `mouse on`.
  terminalEl.addEventListener("wheel", terminalWheelHandler, { capture: true, passive: false });

  window.addEventListener("resize", sendResize);
  highlightActiveSession();

  expandedDiffKey = null;
  refreshChanges();
  changesPollTimer = setInterval(refreshChanges, 5000);

  refreshEnvStatus();
  envPollTimer = setInterval(refreshEnvStatus, 3000);
}

// Cmd+C is the Mac copy shortcut, but xterm's own hidden input textarea can
// end up being what the browser's native copy command targets, so the
// selected terminal text doesn't reliably reach the clipboard. Handle it
// ourselves whenever there's an active selection. Ctrl+C is left alone --
// it must keep sending SIGINT to the shell, matching every other terminal.
function handleTerminalKeyEvent(activeTerm, event) {
  if (!isCopyShortcut(event) || !activeTerm.hasSelection()) return true;

  event.preventDefault();
  copyToClipboard(activeTerm, activeTerm.getSelection());
  return false;
}

function copyToClipboard(activeTerm, text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showCopyToast(true),
      () => copyToClipboardFallback(activeTerm, text),
    );
  } else {
    copyToClipboardFallback(activeTerm, text);
  }
}

// navigator.clipboard.writeText needs a secure context (HTTPS/localhost),
// which this app's own README steers deployments away from (recommending a
// plain-HTTP WireGuard/Tailscale tunnel instead). Fall back to the legacy
// execCommand path -- and if even that fails, hand the user a normal,
// focused, pre-selected text box: the browser's native Cmd+C handling for
// editable elements isn't gated by any of the above.
function copyToClipboardFallback(activeTerm, text) {
  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.style.position = "fixed";
  scratch.style.opacity = "0";
  document.body.appendChild(scratch);
  scratch.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  scratch.remove();
  // execCommand("copy") moves focus onto the scratch textarea; move it back
  // to the terminal's own input so keystrokes keep reaching the shell.
  activeTerm.focus();

  if (copied) {
    showCopyToast(true);
  } else {
    console.warn("tmux-web: copy to clipboard failed");
    showCopyFallbackBox(text);
  }
}

let copyToastTimer = null;

function showCopyToast(success) {
  if (success) hideCopyFallbackBox();
  copyToastEl.textContent = copyResultMessage(success);
  copyToastEl.classList.toggle("copy-toast-error", !success);
  copyToastEl.style.display = "block";
  clearTimeout(copyToastTimer);
  // A failed copy stays up alongside the fallback box below until the user
  // dismisses it or a later copy succeeds -- only auto-dismiss on success.
  if (success) {
    copyToastTimer = setTimeout(() => {
      copyToastEl.style.display = "none";
    }, COPY_TOAST_DURATION_MS);
  }
}

function showCopyFallbackBox(text) {
  showCopyToast(false);
  copyFallbackInputEl.value = text;
  copyFallbackEl.style.display = "flex";
  copyFallbackInputEl.focus();
  copyFallbackInputEl.select();
}

function hideCopyFallbackBox() {
  copyFallbackEl.style.display = "none";
  copyFallbackInputEl.value = "";
  copyToastEl.style.display = "none";
}

copyFallbackCloseBtn.addEventListener("click", () => {
  hideCopyFallbackBox();
  if (term) term.focus();
});

function sendResize() {
  if (!fitAddon || !socket || socket.readyState !== WebSocket.OPEN) return;
  fitAddon.fit();
  socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
}

// Normalizes a wheel event's deltaY to a signed line count. Browsers report
// deltaY in different units depending on input device and deltaMode: pixels
// (0, the common case for mice and trackpads), lines (1), or pages (2).
function wheelEventToLines(event) {
  if (event.deltaMode === 1) return event.deltaY;
  if (event.deltaMode === 2) return event.deltaY * (term ? term.rows : 24);
  return event.deltaY / SCROLL_PIXELS_PER_LINE;
}

// Drives tmux's own copy-mode scrollback (see the "scroll" WS message
// handling in pty-bridge.ts) instead of xterm.js's native wheel handling --
// see the addEventListener call site in attachToSession for why. Deltas are
// accumulated across ticks so fast/short wheel notches still add up to whole
// lines instead of being truncated to zero every time.
function handleTerminalWheel(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  wheelLineAccumulator += wheelEventToLines(event);
  const lines = Math.trunc(wheelLineAccumulator);
  if (lines === 0) return;
  wheelLineAccumulator -= lines;

  socket.send(JSON.stringify({ type: "scroll", direction: lines < 0 ? "up" : "down", lines: Math.abs(lines) }));
}

function highlightActiveSession() {
  for (const item of sessionListEl.querySelectorAll(".session-item")) {
    item.classList.toggle("active", item.dataset.name === activeSessionName);
  }
}

function detachTerminal() {
  window.removeEventListener("resize", sendResize);
  if (terminalWheelHandler) {
    terminalEl.removeEventListener("wheel", terminalWheelHandler, { capture: true });
    terminalWheelHandler = null;
  }
  wheelLineAccumulator = 0;
  if (socket) {
    socket.close();
    socket = null;
  }
  if (term) {
    term.dispose();
    term = null;
  }
  activeSessionName = null;
  emptyStateEl.style.display = "block";
  highlightActiveSession();
  restoreTitle();

  clearTimeout(copyToastTimer);
  hideCopyFallbackBox();

  stopChangesPolling();
  expandedDiffKey = null;
  changesBodyEl.textContent = "";

  stopEnvPolling();
  envBar.style.display = "none";
  closeLogsModal();
}

// --- Changes sidebar (right) ---

toggleChangesBtn.addEventListener("click", () => {
  changesSidebar.classList.toggle("collapsed");
});

function stopChangesPolling() {
  if (changesPollTimer) clearInterval(changesPollTimer);
  changesPollTimer = null;
}

async function refreshChanges() {
  if (!currentProject || !activeSessionName) return;
  const res = await apiFetch(
    projectSessionsUrl("/" + encodeURIComponent(activeSessionName) + "/changes"),
  );
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    location.reload();
    return;
  }
  if (!res.ok) return; // e.g. 404 if the worktree just got removed elsewhere
  const grouped = await res.json();
  renderChangesTree(grouped);
}

const GROUP_LABELS = { staged: "Staged", unstaged: "Unstaged", untracked: "Untracked" };
const STATUS_BADGES = { added: "A", modified: "M", deleted: "D", renamed: "R", untracked: "U" };

function renderChangesTree(grouped) {
  changesBodyEl.textContent = "";
  let anyFiles = false;

  for (const mode of ["staged", "unstaged", "untracked"]) {
    const files = grouped[mode] || [];
    if (files.length === 0) continue;
    anyFiles = true;

    const title = document.createElement("div");
    title.className = "changes-group-title";
    title.textContent = GROUP_LABELS[mode] + " (" + files.length + ")";
    changesBodyEl.appendChild(title);

    const tree = buildFileTree(files);
    renderTreeChildren(tree, changesBodyEl, mode);
  }

  if (!anyFiles) {
    const empty = document.createElement("div");
    empty.className = "changes-empty";
    empty.textContent = "No changes.";
    changesBodyEl.appendChild(empty);
  }

  if (expandedDiffKey) {
    const [mode, path] = [expandedDiffKey.slice(0, expandedDiffKey.indexOf(":")), expandedDiffKey.slice(expandedDiffKey.indexOf(":") + 1)];
    const fileEl = changesBodyEl.querySelector('.tree-file[data-mode="' + CSS.escape(mode) + '"][data-path="' + CSS.escape(path) + '"]');
    if (fileEl) openDiffFor(fileEl, path, mode);
    else expandedDiffKey = null;
  }
}

function buildFileTree(files) {
  const root = { children: new Map() };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, children: new Map(), file: isLast ? file : null });
      }
      node = node.children.get(part);
    }
  }
  return root;
}

function renderTreeChildren(node, container, mode) {
  const entries = Array.from(node.children.values()).sort((a, b) => {
    const aIsFolder = a.children.size > 0;
    const bIsFolder = b.children.size > 0;
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (entry.children.size > 0) {
      const folderRow = document.createElement("div");
      folderRow.className = "tree-folder";
      folderRow.textContent = "\u{1F4C1} " + entry.name;
      const childrenEl = document.createElement("div");
      childrenEl.className = "tree-children";
      folderRow.addEventListener("click", () => {
        childrenEl.style.display = childrenEl.style.display === "none" ? "block" : "none";
      });
      container.appendChild(folderRow);
      container.appendChild(childrenEl);
      renderTreeChildren(entry, childrenEl, mode);
      continue;
    }

    const file = entry.file;
    const fileRow = document.createElement("div");
    fileRow.className = "tree-file status-" + file.status;
    fileRow.dataset.mode = mode;
    fileRow.dataset.path = file.path;

    const badge = document.createElement("span");
    badge.className = "status-badge";
    badge.textContent = STATUS_BADGES[file.status] || "?";
    const label = document.createElement("span");
    label.textContent = entry.name;

    fileRow.appendChild(badge);
    fileRow.appendChild(label);
    fileRow.addEventListener("click", () => toggleDiff(fileRow, file.path, mode));
    container.appendChild(fileRow);
  }
}

async function toggleDiff(fileEl, path, mode) {
  const key = mode + ":" + path;
  const existing = fileEl.nextElementSibling;
  if (existing && existing.classList.contains("diff-panel")) {
    existing.remove();
    if (expandedDiffKey === key) expandedDiffKey = null;
    return;
  }
  await openDiffFor(fileEl, path, mode);
}

async function openDiffFor(fileEl, path, mode) {
  const key = mode + ":" + path;
  const existing = fileEl.nextElementSibling;
  if (existing && existing.classList.contains("diff-panel")) existing.remove();

  expandedDiffKey = key;
  const panel = document.createElement("div");
  panel.className = "diff-panel";
  panel.textContent = "Loading diff…";
  fileEl.after(panel);

  const res = await apiFetch(
    projectSessionsUrl(
      "/" + encodeURIComponent(activeSessionName) + "/diff?path=" + encodeURIComponent(path) + "&mode=" + mode,
    ),
  );
  if (!res.ok) {
    panel.textContent = "Could not load diff.";
    return;
  }
  const result = await res.json();
  panel.textContent = "";

  if (result.isBinary) {
    const note = document.createElement("div");
    note.className = "diff-note";
    note.textContent = "Binary file changed.";
    panel.appendChild(note);
    return;
  }

  if (result.isUntracked) {
    const note = document.createElement("div");
    note.className = "diff-note";
    note.textContent = "New file:";
    panel.appendChild(note);
    panel.appendChild(renderDiffLines(result.diff.split("\n").map((line) => "+" + line).join("\n")));
    return;
  }

  panel.appendChild(renderDiffLines(result.diff));
}

function renderDiffLines(diffText) {
  const container = document.createElement("div");
  container.className = "diff-content";
  for (const line of diffText.split("\n")) {
    const lineEl = document.createElement("div");
    lineEl.textContent = line || " ";
    if (line.startsWith("+++") || line.startsWith("---")) lineEl.classList.add("diff-line", "diff-file-header");
    else if (line.startsWith("@@")) lineEl.classList.add("diff-line", "diff-hunk");
    else if (line.startsWith("+")) lineEl.classList.add("diff-line", "diff-add");
    else if (line.startsWith("-")) lineEl.classList.add("diff-line", "diff-del");
    else lineEl.classList.add("diff-line", "diff-context");
    container.appendChild(lineEl);
  }
  return container;
}

// --- Environment setup (docker-compose, one-click per session) ---

const ENV_PHASE_LABELS = {
  idle: "Idle",
  starting: "Starting…",
  running: "Running",
  error: "Error",
  stopping: "Stopping…",
};

function envSessionUrl() {
  return projectSessionsUrl("/" + encodeURIComponent(activeSessionName) + "/env");
}

function stopEnvPolling() {
  if (envPollTimer) clearInterval(envPollTimer);
  envPollTimer = null;
}

async function refreshEnvStatus() {
  if (!currentProject || !activeSessionName) return;
  const res = await apiFetch(envSessionUrl());
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    location.reload();
    return;
  }
  if (!res.ok) return; // e.g. 404 if the worktree just got removed elsewhere
  renderEnvBar(await res.json());
}

function renderEnvBar(status) {
  if (status.phase === "unavailable") {
    envBar.style.display = "none";
    closeLogsModal();
    return;
  }

  envBar.style.display = "flex";
  envStatusBadge.textContent = ENV_PHASE_LABELS[status.phase] || status.phase;
  envStatusBadge.className = "env-status-badge phase-" + status.phase;
  envMessageEl.textContent = status.message || "";

  envSetupBtn.style.display = status.phase === "idle" ? "inline-block" : "none";
  envStopBtn.style.display = status.phase === "running" || status.phase === "error" ? "inline-block" : "none";

  const services = status.services || [];
  envLogsBtn.style.display = services.length > 0 ? "inline-block" : "none";
  renderLogsServiceOptions(services);
  if (services.length === 0) closeLogsModal();

  if (status.openUrl) {
    envOpenLink.href = status.openUrl;
    envOpenLink.style.display = "inline-block";
  } else {
    envOpenLink.style.display = "none";
  }
}

envSetupBtn.addEventListener("click", async () => {
  envSetupBtn.disabled = true;
  const res = await apiFetch(envSessionUrl(), { method: "POST" });
  envSetupBtn.disabled = false;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    window.alert("Could not start environment: " + (body.error || res.status));
    return;
  }
  await refreshEnvStatus();
});

envStopBtn.addEventListener("click", async () => {
  if (!window.confirm("Stop this session's environment? This runs `docker compose down -v`, removing its containers and volumes.")) {
    return;
  }
  envStopBtn.disabled = true;
  const res = await apiFetch(envSessionUrl(), { method: "DELETE" });
  envStopBtn.disabled = false;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    window.alert("Could not stop environment: " + (body.error || res.status));
    return;
  }
  await refreshEnvStatus();
});

// --- Logs modal (docker compose logs -f, streamed over /ws/logs) ---
// Reuses xterm.js (already loaded for the main terminal) purely as a
// read-only ANSI renderer -- docker compose already colors/prefixes each
// service's lines, so this needs no custom log-line rendering of its own.

function renderLogsServiceOptions(services) {
  const previousValue = logsServiceSelect.value;
  logsServiceSelect.textContent = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All services";
  logsServiceSelect.appendChild(allOption);

  for (const svc of services) {
    const option = document.createElement("option");
    option.value = svc.service;
    option.textContent = svc.service;
    logsServiceSelect.appendChild(option);
  }

  logsServiceSelect.value = services.some((svc) => svc.service === previousValue) ? previousValue : "";
}

function fitLogsTerminal() {
  if (logsFitAddon) logsFitAddon.fit();
}

function connectLogsSocket() {
  if (logsSocket) {
    logsSocket.close();
    logsSocket = null;
  }
  if (logsTerm) logsTerm.clear();

  const service = logsServiceSelect.value;
  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  let url =
    wsProtocol + "//" + location.host +
    "/ws/logs?project=" + encodeURIComponent(currentProject.id) +
    "&session=" + encodeURIComponent(activeSessionName) +
    "&token=" + encodeURIComponent(token);
  if (service) url += "&service=" + encodeURIComponent(service);

  // Captured by reference (not read from the `logsSocket` variable) so a
  // still-in-flight message/close from a socket we just replaced -- e.g.
  // the previous service filter's connection, which close() doesn't tear
  // down synchronously -- can never write into the terminal that's now
  // showing a different stream.
  const socket = new WebSocket(url);
  logsSocket = socket;

  socket.addEventListener("message", (event) => {
    if (logsTerm && logsSocket === socket) logsTerm.write(event.data);
  });

  socket.addEventListener("close", () => {
    if (logsTerm && logsSocket === socket) logsTerm.write("\r\n\x1b[90m[log stream closed]\x1b[0m\r\n");
  });
}

function handleLogsModalKeydown(event) {
  if (event.key === "Escape") closeLogsModal();
}

function openLogsModal() {
  logsModal.style.display = "flex";

  logsTerm = new Terminal({
    fontSize: 13,
    disableStdin: true,
    cursorStyle: "bar",
    cursorBlink: false,
  });
  logsFitAddon = new FitAddon.FitAddon();
  logsTerm.loadAddon(logsFitAddon);
  logsTerm.open(logsTerminalEl);
  logsFitAddon.fit();
  window.addEventListener("resize", fitLogsTerminal);
  document.addEventListener("keydown", handleLogsModalKeydown);

  connectLogsSocket();
}

function closeLogsModal() {
  if (logsModal.style.display === "none") return;
  logsModal.style.display = "none";
  window.removeEventListener("resize", fitLogsTerminal);
  document.removeEventListener("keydown", handleLogsModalKeydown);

  if (logsSocket) {
    logsSocket.close();
    logsSocket = null;
  }
  if (logsTerm) {
    logsTerm.dispose();
    logsTerm = null;
  }
  logsFitAddon = null;
}

envLogsBtn.addEventListener("click", () => openLogsModal());
logsCloseBtn.addEventListener("click", () => closeLogsModal());
logsServiceSelect.addEventListener("change", () => connectLogsSocket());

if (token) {
  tryLogin(token).then((ok) => {
    if (ok) enterApp();
    else sessionStorage.removeItem(TOKEN_KEY);
  });
}
