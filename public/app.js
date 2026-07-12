// Vanilla JS, no build step. Keep this file small enough to read in one
// sitting -- that's the whole point of a self-audited tool.

const TOKEN_KEY = "tmux-web-token";

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
const terminalEl = document.getElementById("terminal");
const emptyStateEl = document.getElementById("empty-state");

const changesSidebar = document.getElementById("changes-sidebar");
const changesBodyEl = document.getElementById("changes-body");
const toggleChangesBtn = document.getElementById("toggle-changes");

let token = sessionStorage.getItem(TOKEN_KEY) || "";
let currentProject = null; // { id, name, repoPath, createdAt }
let activeSessionName = null; // display name (slug), not the full tmux name
let socket = null;
let term = null;
let fitAddon = null;
let sessionPollTimer = null;
let changesPollTimer = null;
let expandedDiffKey = null; // "mode:path" of the single currently-open inline diff, or null

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

newSessionBtn.addEventListener("click", async () => {
  const name = window.prompt("New session name (becomes a git branch + worktree):");
  if (!name) return;
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

  term = new Terminal({ cursorBlink: true, fontSize: 14 });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminalEl);
  fitAddon.fit();

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

  window.addEventListener("resize", sendResize);
  highlightActiveSession();

  expandedDiffKey = null;
  refreshChanges();
  changesPollTimer = setInterval(refreshChanges, 5000);
}

function sendResize() {
  if (!fitAddon || !socket || socket.readyState !== WebSocket.OPEN) return;
  fitAddon.fit();
  socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
}

function highlightActiveSession() {
  for (const item of sessionListEl.querySelectorAll(".session-item")) {
    item.classList.toggle("active", item.dataset.name === activeSessionName);
  }
}

function detachTerminal() {
  window.removeEventListener("resize", sendResize);
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

  stopChangesPolling();
  expandedDiffKey = null;
  changesBodyEl.textContent = "";
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

if (token) {
  tryLogin(token).then((ok) => {
    if (ok) enterApp();
    else sessionStorage.removeItem(TOKEN_KEY);
  });
}
