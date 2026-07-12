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

let token = sessionStorage.getItem(TOKEN_KEY) || "";
let currentProject = null; // { id, name, repoPath, createdAt }
let activeSessionName = null; // display name (slug), not the full tmux name
let socket = null;
let term = null;
let fitAddon = null;
let sessionPollTimer = null;

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
}

if (token) {
  tryLogin(token).then((ok) => {
    if (ok) enterApp();
    else sessionStorage.removeItem(TOKEN_KEY);
  });
}
