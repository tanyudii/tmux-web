// Vanilla JS, no build step. Keep this file small enough to read in one
// sitting -- that's the whole point of a self-audited tool.

const TOKEN_KEY = "tmux-web-token";

const loginForm = document.getElementById("login");
const tokenInput = document.getElementById("token");
const loginError = document.getElementById("login-error");
const appEl = document.getElementById("app");
const sessionListEl = document.getElementById("session-list");
const newSessionBtn = document.getElementById("new-session");
const terminalEl = document.getElementById("terminal");
const emptyStateEl = document.getElementById("empty-state");

let token = sessionStorage.getItem(TOKEN_KEY) || "";
let activeSessionName = null;
let socket = null;
let term = null;
let fitAddon = null;
let pollTimer = null;

function apiFetch(path, options) {
  const headers = Object.assign({}, (options && options.headers) || {}, {
    Authorization: "Bearer " + token,
  });
  return fetch(path, Object.assign({}, options, { headers }));
}

async function tryLogin(candidateToken) {
  const res = await fetch("/api/sessions", {
    headers: { Authorization: "Bearer " + candidateToken },
  });
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
  refreshSessions();
  pollTimer = setInterval(refreshSessions, 4000);
}

async function refreshSessions() {
  const res = await apiFetch("/api/sessions");
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
    label.addEventListener("click", () => attachToSession(session.name));

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
  const name = window.prompt("New session name (letters, numbers, -, _):");
  if (!name) return;
  const res = await apiFetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    window.alert("Could not create session: " + (body.error || res.status));
    return;
  }
  await refreshSessions();
  attachToSession(name);
});

async function killSession(name) {
  if (!window.confirm('Kill session "' + name + '"? This ends every process running inside it.')) {
    return;
  }
  await apiFetch("/api/sessions/" + encodeURIComponent(name), { method: "DELETE" });
  if (name === activeSessionName) {
    detach();
  }
  await refreshSessions();
}

function attachToSession(name) {
  if (name === activeSessionName && socket) return;
  detach();
  activeSessionName = name;
  emptyStateEl.style.display = "none";

  term = new Terminal({ cursorBlink: true, fontSize: 14 });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminalEl);
  fitAddon.fit();

  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url =
    wsProtocol + "//" + location.host + "/ws?session=" + encodeURIComponent(name) + "&token=" + encodeURIComponent(token);
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

function highlightActiveSession() {
  for (const item of sessionListEl.querySelectorAll(".session-item")) {
    item.classList.toggle("active", item.dataset.name === activeSessionName);
  }
}

function sendResize() {
  if (!fitAddon || !socket || socket.readyState !== WebSocket.OPEN) return;
  fitAddon.fit();
  socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
}

function detach() {
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
