# tmux-web

[![CI](https://github.com/tanyudii/tmux-web/actions/workflows/ci.yml/badge.svg)](https://github.com/tanyudii/tmux-web/actions/workflows/ci.yml)

A small, self-hosted browser GUI for working across projects and tmux
sessions. No cloud account, no relay, no external dependency of any kind —
just your server, git, tmux, and a browser.

The flow mirrors what you'd get from a hosted dev-environment product like
Superset, minus the account/relay: **open a project → it can hold many
sessions → every session is an isolated git worktree** on its own branch,
so parallel sessions never collide on the same working directory.

Built to be read in one sitting: most of the core (`src/`) shells out to
`tmux`/`git`/`docker` rather than reimplementing them, keeping runtime
dependencies to `node-pty` and `ws` for the terminal/WebSocket bridge, plus
`@modelcontextprotocol/sdk` and `zod` for the optional `tmuxweb mcp` server
below — the per-session environment feature shells out to the
`docker`/`docker compose` CLIs already on your system rather than adding a
client library.

The web client is a hand-written SolidJS + Vite PWA under `web/` —
installable to the home screen on iOS Safari, so it runs full-screen
without going through the App Store. It replaced an earlier Kotlin
Multiplatform + Compose Multiplatform client (`kmp/`, both a web target and
a native iOS SwiftUI app) once it reached full feature parity — see
`docs/adr/0004-solidjs-pwa-migration.md` for why, and
`.claude/plans/rebuild-web-ios-kmp.plan.md` for the phase-by-phase
migration history. The backend (`src/`) has been a frozen contract
throughout every client rewrite.

## How it works

- **Projects** are just a name + an absolute path to a git repo on the
  server, registered once via the UI and persisted to
  `~/.tmux-web/projects.json`.
- **Sessions belong to a project.** Creating one slugifies the name into a
  branch name, resolves the project's `origin` remote default branch
  (`git ls-remote --symref origin HEAD` — works for `main`, `master`, or
  any other name, not hardcoded), fetches it, then runs
  `git worktree add -b <branch> ~/.tmux-web/worktrees/<projectId>/<branch> origin/<default-branch>`.
  New sessions always start from the latest pushed `origin` state, not
  whatever happens to be checked out locally (or uncommitted/unpushed
  local work) in the project's repo. It then starts a real `tmux` session
  with its working directory set to that worktree
  (`tmux new-session -c <worktree>`). Killing a session kills the tmux
  session, then removes the worktree — but **not** the branch, so your
  commits survive even after the session is gone.
- Every "session" in the sidebar is a real `tmux` session — this tool never
  reimplements session persistence. It just runs `tmux attach-session`
  inside a PTY (via `node-pty`) and streams the bytes over a WebSocket to
  an `xterm.js` terminal in the browser. There's no separate database
  tracking which sessions exist: `tmux list-sessions`, filtered by a
  `<projectId>__<slug>` naming convention, *is* the source of truth.
- Because tmux itself owns the session state, closing a browser tab is
  exactly like a tmux detach (`Ctrl-b d`): nothing inside the session
  dies. Restarting this Node process doesn't touch tmux either — reopen
  the browser and reattach.
- **Mouse-wheel scroll works out of the box, independent of your
  `tmux.conf`.** tmux repaints its pane via cursor positioning rather than
  emitting new lines, so a browser terminal's own native scrollback is
  mostly useless for a tmux session — the real scrollback lives inside
  tmux's own copy-mode. Scrolling over the terminal sends a small `scroll`
  message over the existing WebSocket, and the server drives that
  copy-mode directly via the `tmux` CLI (`copy-mode` + `send-keys -X
  scroll-up`/`scroll-down`) — the same "shell out to `tmux`" approach used
  everywhere else in this tool. This works whether or not you have `set -g
  mouse on` yourself; typing again automatically cancels copy-mode and
  hands the keystroke back to the shell.
- **Uncommitted changes are protected.** If a worktree has uncommitted
  changes, killing its session is refused (409) until you explicitly
  confirm force-delete in the UI — this tool never silently discards
  work, unlike some worktree-removal defaults elsewhere.
- A single shared token (`~/.tmux-web/config.json`, see `tmuxweb generate`)
  gates every API and WebSocket
  request, compared with a constant-time check (`crypto.timingSafeEqual`).
- **The right sidebar shows what's changed** in the attached session's
  worktree — staged/unstaged/untracked files as a collapsible tree, click a
  file to see its diff inline. The diff text is whatever `git diff` prints;
  this tool doesn't compute diffs itself, it just colors the `+`/`-` lines
  git already produced. Polls every 5s while a session is attached.
- **One-click, per-session environments.** If a project's worktree has a
  `.tmux-web-env/docker-compose.yml`, an "Environment" bar appears above
  the terminal with a **Setup Environment** button. Clicking it runs an
  optional `pre-run.sh`, then `docker compose up -d --build` scoped to
  *that session alone* (its own containers, network, and volumes — a
  second session never shares them), then an optional `post-run.sh`. Once
  containers are up, tmux-web resolves the ephemeral host port docker
  published for each configured service and shows an **Open ↗** link per
  service — handy when a session runs more than one thing you want to open
  (e.g. the frontend *and* a database UI like DBeaver's web client for
  checking the data it just wrote). A **Logs** button also appears,
  streaming `docker compose logs -f` for
  every container in that session's environment into a single dashboard —
  no more switching terminals to tail one container at a time. See
  [Per-session environments](#per-session-environments-docker-compose)
  below.
- **The tab notifies you when a session needs attention.** tmux-web listens
  for the terminal bell character (`BEL`, `\x07`) on the attached session —
  the same signal Claude Code rings for its `Notification` (needs
  permission, asks a question) and `Stop` (task finished) events. If the
  tab isn't focused when the bell fires, it plays a short beep, flashes the
  tab title, and shows a desktop notification (if you've granted browser
  permission) so you know to switch back. Toggle it off with the bell
  button (🔔/🔕) next to "← Projects". **This requires Claude Code's own
  `preferredNotifChannel` setting to be `terminal_bell`** — its default
  (`auto`) stays silent outside iTerm2/Kitty/Ghostty, which is the normal
  case when running through tmux-web:
  ```bash
  claude config set --global preferredNotifChannel terminal_bell
  ```
  Because this is a generic BEL listener (not string-matching Claude's
  output), it also fires for any other program in the session that rings
  the terminal bell — by design, so "and anything else that needs you" is
  covered without extra configuration.

## Security model — read this before deploying

This tool grants shell access to whatever user runs it. Treat it
accordingly:

1. **Never bind it to a public interface.** Use `tmuxweb config host <addr>`
   to bind only to a private interface — e.g. your WireGuard/Tailscale
   tunnel IP, or `127.0.0.1` behind your own reverse proxy. Do not
   port-forward this on your router.
2. **Run it as a non-root, non-privileged user.** The provided systemd
   unit runs as a `--user` service, not root.
3. **Generate a real token**, not a short/guessable string — `tmuxweb init`
   does this for you automatically; rotate it any time with:
   ```bash
   tmuxweb generate
   ```
4. **The access log records per-token activity, not per-person identity.**
   Every bearer-token-authenticated API/WS request is appended to
   `<data dir>/access.log` (timestamp, IP, method, path, and whether the
   token check passed) — viewable read-only from the Web UI's sidebar
   ("Access log"). Because this tool has one shared token rather than
   per-user accounts, this log tells you *what happened when from which
   IP*, not *who* did it in any personal sense — if you share the token
   with multiple people/devices, they're indistinguishable in this log.
   The file rotates automatically (5 MiB per generation, 5 generations
   kept) so it never grows unbounded.
5. **Audit it yourself.** This is a young, low-adoption project (it's
   yours). Before trusting it with real access, read at minimum:
   `src/auth.ts` (token check), `src/server.ts` (route handling and error
   mapping), `src/worktree.ts` and `src/git-status.ts` (every `git`
   invocation this tool makes, including the diff-endpoint's path-traversal
   guard), and `src/main.ts` (how they're wired together with the WebSocket
   upgrade).
6. **The per-session environment feature extends this trust to Docker.**
   `docker compose up` runs *whatever* `docker-compose.yml` (plus
   `pre-run.sh`/`post-run.sh`) is checked into the worktree at the time —
   by design, so the environment reflects the branch you're actually
   working on (see [Per-session
   environments](#per-session-environments-docker-compose)). This is not a
   new privilege boundary: anyone who can push to a branch you'll open a
   session on already gets a real shell in that worktree via this tool.
   But note that on most default installs, membership in the `docker`
   group is root-equivalent — so enabling this feature is equivalent to
   the account running tmux-web already having root, whether or not it's
   used. If that's not an acceptable tradeoff for your deployment, simply
   don't add a `.tmux-web-env/` folder to any project you register — the
   feature stays entirely invisible (and inert) for repos that don't opt
   in.

## Requirements on the host machine

- Node.js >= 22 (uses `--experimental-strip-types` to run TypeScript
  directly — no build step, no `dist/` to keep in sync with source)
- `tmux` installed (`apt install tmux` / `brew install tmux`)
- `git` installed — projects must already be git repos; worktrees are
  created from them
- Build tools for `node-pty`'s native addon on first install:
  `apt install build-essential python3` (Debian/Ubuntu)
- **Optional**: `docker` + the `docker compose` v2 plugin, only needed if
  you use the per-session environment feature on any registered project.
  Everything else works fine without Docker installed at all.
- **For a global install from the private repo**: SSH access to
  `git@github.com:tanyudii/tmux-web` on the server (a deploy key with
  read-only access works well) — both the bootstrap clone below and
  `tmuxweb upgrade` use `git clone`/`git fetch` over SSH directly.
- **`gh` (GitHub CLI), installed and authenticated** — `tmuxweb upgrade`
  shells out to `gh release download` to fetch the prebuilt web UI bundle
  from this repo's GitHub Releases. Install per <https://cli.github.com/>,
  then run `gh auth login` once (or set `GH_TOKEN`/`GITHUB_TOKEN` in the
  environment the service runs under) — a one-time setup, analogous to the
  SSH deploy key above. Not strictly required: if `gh` isn't set up,
  `tmuxweb upgrade` still succeeds and the server still runs, it just
  serves the API only (no web UI) until `gh` is configured and you
  upgrade again.

## Installation (global CLI, production)

`npm install -g github:tanyudii/tmux-web#<tag>` does **not** work on Node 22
for this package, and never will — don't reintroduce it. Two independent
reasons: (1) npm/pacote tries an HTTPS tarball shortcut via
`codeload.github.com` before falling back to git, which 404s for a private
repo and doesn't fall back correctly; (2) even when a global npm install
*does* land the package under `node_modules`, Node 22 refuses to
type-strip any `.ts` file that lives inside a directory literally named
`node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, no override
flag) — and this package ships raw `.ts`, by design (see above). So instead,
install by cloning tmux-web's own code to a fixed location *outside*
`node_modules`, then linking it:

```bash
git clone --branch v1.0.2 --depth 1 git@github.com:tanyudii/tmux-web.git ~/.local/share/tmux-web
cd ~/.local/share/tmux-web
npm ci --omit=dev
npm link
tmuxweb upgrade --tag v1.0.2
```

`~/.local/share/tmux-web` (the XDG convention for installed application
code) is deliberately separate from `~/.tmux-web`, which holds runtime data
only — token, port, host, projects, worktrees (see "Data directory" below).
This is the same clone-and-install shape as **Local development** below,
minus dev dependencies and plus the global `npm link`.

The final `tmuxweb upgrade --tag v1.0.2` re-targets the exact tag you just
cloned. On the code itself it's a no-op (already checked out; `npm
ci`/`npm link` just re-run harmlessly) — its real job here is fetching and
installing that tag's prebuilt web UI bundle from its GitHub Release (see
"Upgrading" below), which the bootstrap clone above doesn't include
(`web/dist/` is gitignored, by design). This reuses the same,
already-tested code path as every later `tmuxweb upgrade` rather than
documenting a separate manual `gh release download` command here. Skipping
this step still leaves you with a fully working install — just API-only, no
web UI — until the next `tmuxweb upgrade`.

Either way this puts a `tmuxweb` binary on your `PATH`. Then:

```bash
tmuxweb init              # creates ~/.tmux-web/config.json with a generated token
tmuxweb service install   # installs + starts a systemd --user service
```

`tmuxweb init` prints the generated token once — save it, you'll need it to
open the UI. `tmuxweb help` lists every subcommand.

### Configuring port and host

```bash
tmuxweb config port 5309
tmuxweb config host 127.0.0.1   # see "Security model" above before changing this
```

Both write to `~/.tmux-web/config.json`; restart the service afterward
(`systemctl --user restart tmux-web`) for the change to take effect.

### Rotating the token

```bash
tmuxweb generate
```

Prints the new token and restarts nothing for you — restart the service
afterward so the running process picks it up.

### Upgrading

```bash
tmuxweb upgrade                          # resolves and installs the latest tag
tmuxweb upgrade --tag v1.2.0             # pin to a specific tag
tmuxweb upgrade --app-dir /other/path    # if you installed somewhere other than ~/.local/share/tmux-web
```

Internally this is the same clone-or-update + `npm ci --omit=dev` +
`npm link` flow described above, run again against the resolved tag, plus
one more step: it downloads that tag's prebuilt web UI bundle from this
repo's GitHub Release (via the `gh` CLI — see "Requirements on the host
machine" above) and extracts it to
`~/.local/share/tmux-web/web/dist`,
where the running server looks for it. That step is best-effort: if `gh`
isn't installed/authenticated, or a given release has no web UI asset (e.g.
an old tag cut before this mechanism existed), `tmuxweb upgrade` logs a
warning and continues — you still end up with a working install, serving
the API only, until it's fixed and you upgrade again. If
`~/.local/share/tmux-web` is already a clone of this repo, it fetches the
target tag and checks it out in place; if it's missing (or looks like
leftover junk from an interrupted install), it clones fresh — `tmuxweb
upgrade` is self-healing either way. It finishes by restarting the systemd
service automatically if it was already running.

## Local development

```bash
git clone git@github.com:tanyudii/tmux-web.git
cd tmux-web
npm install
npm run init                 # creates ~/.tmux-web/config.json with a generated token

npm test                    # includes real-tmux, real-git and real-npm integration tests
npm run typecheck

npm run dev                 # watch mode, or `npm start` for a plain foreground run
```

Same underlying shape as the production install above (`git clone` +
`npm install`), minus `--omit=dev` and `npm link`.

Open `http://<host>:<port>` (`http://127.0.0.1:5309` by default — see
`~/.tmux-web/config.json`), paste the token, click **+ Add project** and
point it at an absolute path to a git repo already on this server, open the
project, then **+ New session** and confirm you land in a real shell whose
`pwd` is a freshly created worktree.

### Web client (PWA)

`npm run dev` above only starts the backend (API + WebSocket). The web
client itself lives under `web/` as a separate npm project and needs its
own install/build:

```bash
cd web
npm install
npm run build                # writes web/dist -- src/main.ts serves this
                              # automatically once it exists (see the
                              # DEFAULT_WEB_BUILD_DIR log line at startup)

# or, for fast iteration with hot reload against a real backend:
npm run dev                  # Vite dev server; point its proxy/base URL at
                              # the backend's host:port from ~/.tmux-web/config.json
```

`npm test` / `npm run typecheck` in `web/` run its own Vitest suite and
`tsc --noEmit` — kept separate from the root project's `npm test` since
they're two independent npm projects with their own `package.json`/
`package-lock.json` (see `web-ci.yml`, which runs on every push touching
`web/**`). Any UI-affecting change must additionally be verified live in a
real browser before being called done — see this repo's `CLAUDE.md`.

### Data directory

Everything this tool persists lives under `~/.tmux-web/`:

```
~/.tmux-web/
  config.json             token, port, host (see `tmuxweb config`/`tmuxweb generate`)
  projects.json          registered projects (name, id, repo path)
  worktrees/
    <projectId>/
      <branch-slug>/      one git worktree per active session
```

Nothing here is a database — `config.json` and `projects.json` are plain
JSON (atomic write via temp-file + rename), and the worktree directories
are just what `git worktree add` produced. You can `cat`, back up, or
hand-edit any of them with tools you already trust.

## Per-session environments (docker-compose)

Opt in per project by adding a `.tmux-web-env/` folder to the repo (so it's
versioned like everything else, and can differ per branch). If you use
Claude Code, `skills/tmux-web-env/` in this repo is an installable skill
that scaffolds this folder for you — see its
[README](skills/tmux-web-env/README.md) for install steps:

```
.tmux-web-env/
  docker-compose.yml   required -- its presence is what makes the
                        "Setup Environment" button appear at all
  env.json              optional -- { "open": [{ "label": "Frontend", "service": "web", "port": 3000 }] }
  pre-run.sh             optional -- runs before `docker compose up`
  post-run.sh             optional -- runs after `docker compose up`
```

`env.json`'s `open` array lists every service you want an **Open ↗** link
for — not just the main app. Each entry is `{ "label"?, "service", "port" }`
(`label` defaults to the service name). This is the escape hatch for
sessions that run more than one browser-facing thing, e.g. a frontend plus
a database UI for checking the data that frontend just wrote:

```json
{
  "open": [
    { "label": "Frontend", "service": "web", "port": 3000 },
    { "label": "DBeaver", "service": "dbeaver", "port": 8978 }
  ]
}
```

Each entry resolves independently: a service that isn't up yet (or doesn't
publish that port) just doesn't show a link yet, without blocking the
others from appearing. The older single-service shape,
`{ "openService": "web", "openPort": 3000 }`, still works as a shorthand
for a one-entry `open` array (labeled "Open") -- if both `open` and
`openService`/`openPort` are present in the same file, `open` wins.

Clicking **Setup Environment** on a session:

1. Runs `pre-run.sh` (if present) with the worktree as its working
   directory -- e.g. to write a `.env` file, seed fixtures, or install
   dependencies the compose file's `build:` step expects.
2. Runs `docker compose up -d --build`, scoped with
   `-p <projectId>__<sessionSlug>` -- the exact same composite name this
   tool already uses for the session's tmux session (`session-naming.ts`),
   so every session's containers, network, and volumes are namespaced
   apart from every other session's, including other sessions of the same
   project.
3. Runs `post-run.sh` (if present) -- e.g. to run migrations or seed data
   once the database container is reachable.
4. For each entry in `env.json`'s `open` array, resolves the ephemeral host
   port docker published for it (`docker compose port <service> <port>`)
   and shows an **Open ↗** link to `http://<host>:<port>`, labeled per
   entry. A service whose port isn't published yet just doesn't get a link
   until it is -- checked again on the next status poll.

Status (`idle` / `starting` / `running` / `error` / `stopping`) is polled
every 3s and is always re-derived from a live `docker compose ps` rather
than trusted from a cache -- consistent with how this tool already treats
`tmux list-sessions` and `git status` as the source of truth instead of
keeping its own database. Only the fact that a setup is *in progress*
(pre-run/up/post-run can take minutes) lives in an in-memory map for the
life of the Node process; a restart mid-setup just means the next status
poll re-derives `idle` or `running` from docker directly.

**Compose file tip**: publish ports as `"127.0.0.1::<container-port>"`
(no fixed host port) so two sessions of the same project never fight over
the same port -- tmux-web resolves whatever host port docker actually
picked.

**Teardown**: the **Stop** button (or killing the session, which always
tears its environment down first, best-effort) runs `docker compose down
-v` -- containers *and* volumes for that session are gone. There's no
"pause" state.

**Logs dashboard**: once at least one container is up, a **Logs** button
appears next to Stop. Clicking it opens a panel that streams `docker
compose logs --follow --tail=200` -- merged across every service in that
session's environment by default, docker's own interleaved/colored/
prefixed format, rendered through a second read-only `xterm.js` instance
(so ANSI colors just work, no custom log renderer needed). A dropdown lets
you narrow the stream to one service instead of all of them. This is a
live tail only -- there's no history kept once the panel is closed beyond
whatever `docker compose logs` itself would still show you from a
terminal. The underlying `docker compose logs -f` process is spawned only
while the panel is open and killed (`SIGTERM`, then `SIGKILL` after a 3s
grace period) the moment it's closed or the WebSocket drops, so it never
lingers as a background process the way the session's own tmux server
intentionally does.

## Running as a service (survives reboots and crashes)

For a global install (see "Installation" above):

```bash
tmuxweb service install
```

This writes a `systemd --user` unit to `~/.config/systemd/user/tmux-web.service`
(pointing at the resolved `tmuxweb` binary and the exact `node` binary
currently running the command — so it works with nvm/mise/asdf, not just a
system-wide install), then runs `daemon-reload`, `enable --now`, and
`loginctl enable-linger $USER`. There's no `EnvironmentFile` involved —
config is the JSON file at `~/.tmux-web/config.json`, read directly by
whatever process starts the server.

For a local dev clone, `npm run install-service` does the same thing (it's
a thin wrapper around `tmuxweb service install`).

**Autostart on boot / after logout:** enabling the service makes it start
with your user session; enabling *linger* is what keeps that session (and
therefore the service) alive even when you're not logged in, including
across reboots. `loginctl enable-linger` needs admin privileges on most
distros, so if the command can't do it for you, run it yourself once:

```bash
sudo loginctl enable-linger $(whoami)
```

Useful commands afterward:

```bash
tmuxweb service status                  # same as `systemctl --user status tmux-web`
journalctl --user -u tmux-web -f        # tail logs
systemctl --user restart tmux-web       # restart (needed after `tmuxweb config`/`tmuxweb generate`)
tmuxweb service uninstall               # stop and remove from autostart
```

Prefer to inspect the unit before running anything? `deploy/tmux-web.service`
is the same thing `tmuxweb service install` writes, as a plain file you can
read, edit, and install by hand — see the comment at the top of that file.

Because tmux sessions live in the tmux *server* (a separate process,
already independent of this Node process), restarting or crash-looping
`tmux-web.service` never touches your running sessions.

## MCP server (for agent-to-agent use)

`tmuxweb mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io)
server exposing one tool, `send_message`, so another agent (e.g. your own
autonomous "Hermes"-style agent) can drive a real, interactive Claude Code
session inside a tmux-web project worktree and get back either a finished
result or a question that needs an answer.

**Two transports, depending on where your MCP client runs:**

- **stdio (default)** — for a client that spawns `tmuxweb mcp` itself as a
  local subprocess on the *same machine*. This is what most MCP clients
  (Claude Desktop, Claude Code itself, etc.) expect out of the box.

  ```bash
  tmuxweb mcp
  ```

  ```json
  {
    "mcpServers": {
      "tmux-web": {
        "command": "node",
        "args": ["--experimental-strip-types", "/path/to/tmux-web/bin/tmuxweb.ts", "mcp"]
      }
    }
  }
  ```

- **`--http`** — for a client that runs on a **different machine** (e.g.
  your own agent running on a separate server) and needs to reach in over
  the network. stdio cannot do this at all — it's a same-machine process
  pipe, not a network protocol. Point `--host` at a private interface
  (WireGuard/Tailscale, same deployment model as the rest of this app —
  see "Security model" above) and never at a public one.

  ```bash
  tmuxweb mcp --http --host 10.8.0.2 --port 5311
  ```

  This prints a bearer token on first run (persisted at
  `~/.tmux-web/mcp-token`, mode `0600` — reuse it on subsequent starts,
  don't regenerate). Your remote MCP client needs to be configured to POST
  JSON-RPC to `http://10.8.0.2:5311/mcp` with `Authorization: Bearer
  <token>` — consult your MCP client's docs for how it expects a remote
  Streamable HTTP server to be configured (field names vary by client).

**How `send_message` works:**

- `send_message({ project, sessionName, message })` — `project` is an
  existing tmux-web project's name or id (register it first via the normal
  UI/`~/.tmux-web/projects.json`); `sessionName` identifies the session.
- The **first** call for a given `sessionName` creates a worktree + tmux
  session and launches a real, interactive `claude` REPL in it — never
  `claude -p`. Your `message` is then typed into that REPL exactly as if
  you'd typed it yourself right after opening the session.
- **Every subsequent call** with the same `sessionName` types straight into
  that same still-running REPL, so the full conversation context is never
  reset between calls — this is the whole point of using a persistent
  session instead of one-shot invocations.
- The tool call blocks until Claude either finishes the turn
  (`status: "result"`) or needs your input/permission
  (`status: "question"`) — call `send_message` again with the same
  `sessionName` and your reply to continue. A call against a session that's
  still mid-turn returns `status: "busy"` instead of queuing.
- Detecting "finished" vs "needs input" reuses this app's own
  `Stop`/`Notification` hook mechanism (see the bell-notification feature
  above) — `tmuxweb mcp` auto-installs both hooks into the session's
  worktree-local `.claude/settings.local.json` on session creation (merged
  with, not overwriting, any hooks already there). This never touches your
  real global `~/.claude/settings.json`, and disappears along with the
  worktree when the session is deleted.

**Security notes:**

- Anything with access to this MCP server (either transport) can make
  Claude Code execute arbitrary instructions inside a real worktree on this
  machine — the same trust level as the main HTTP API's bearer token (see
  "Security model" above). Only expose it to agents/processes you already
  trust with shell access to this host.
- `--http` mode is bearer-token gated with its own dedicated token
  (`~/.tmux-web/mcp-token`, mode `0600`, separate from both the main API's
  token and the hook-listener's secret below) — unlike stdio, where "can
  spawn a local process" is implicitly the trust boundary, a network
  listener needs an explicit credential, since anything reachable on that
  network segment could otherwise call `send_message`. Losing control of
  this token is equivalent to losing control of the main API token: rotate
  it by deleting the file and restarting `tmuxweb mcp --http` (a fresh one
  is generated on next start; there's no `tmuxweb mcp generate` command
  yet, unlike the main token's `tmuxweb generate`).
- `tmuxweb mcp` also opens a **second**, separate local HTTP listener (port
  5310 by default) that the installed hooks POST to when a session
  finishes a turn or needs input. This is a distinct trust boundary from
  the MCP stdio transport above — it's reachable by any local process, not
  just whatever you've authorized to speak MCP to this server. It requires
  a bearer secret (auto-generated once per install at
  `~/.tmux-web/mcp-hook-secret`, mode `0600`, read directly from that file
  by the installed hook at the moment it fires — never passed as a
  command-line argument or embedded in `settings.local.json`, both of
  which would otherwise leak it to any local user via `ps`/`/proc` or a
  world-readable config file) on every request, so a same-machine process
  that doesn't have that file can't forge a session's result/question back
  to the calling agent — but it's still worth knowing this second listener
  exists and is a lower trust boundary than "only
  MCP-authorized callers."

## Project layout

```
src/
  auth.ts               token extraction + constant-time verification
  slug.ts                branch-name slugification (pure)
  session-naming.ts       <projectId>__<slug> composite tmux session names
  tmux.ts                shells out to `tmux` (list/create/kill sessions)
  worktree.ts             shells out to `git worktree` (add/remove/prune)
  git-status.ts           shells out to `git status`/`git diff` for the changes sidebar
  projects.ts             project registry (JSON file, atomic writes)
  project-sessions.ts      orchestrates projects+worktree+tmux per session
  env-config.ts            reads the opt-in .tmux-web-env/ folder from a worktree
  docker-compose.ts        shells out to `docker compose` (up/down/ps/port/logs)
  log-stream.ts             streams `docker compose logs -f` to a WebSocket,
                            killing the process when the socket closes
  service-name.ts            validates the optional ?service= filter on
                            /ws/logs against docker compose's naming rules
  run-script.ts            runs pre-run.sh/post-run.sh via /bin/sh
  session-env.ts           orchestrates pre-run -> compose up -> post-run per session
  server.ts               HTTP API + auth middleware (testable via injected deps)
  pty-bridge.ts            node-pty <-> WebSocket bridge, resize handling
  config.ts               JSON config read/write (~/.tmux-web/config.json)
  main.ts                 composition root: wires the above into a real server
  mcp/
    server.ts               MCP server + send_message tool definition
    send-message.ts          create/reuse a session, type the message, wait for a hook event
    pending-tasks.ts         in-memory busy/idle state machine per tmux session
    hook-listener.ts         loopback HTTP listener that hook-script.ts POSTs to
    hook-script.ts            invoked by Claude Code's Stop/Notification hooks
    hook-config-merge.ts      installs those hooks into a worktree's settings.local.json
    persisted-secret.ts        generic "generate once, persist, 0600" secret file helper
    hook-secret.ts             hook-listener.ts's secret (via persisted-secret.ts)
    mcp-token.ts                http-server.ts's bearer token (via persisted-secret.ts)
    http-server.ts             --http mode: Streamable HTTP transport + bearer auth
  cli/
    index.ts                argv router for the `tmuxweb` command;
                              no subcommand -> help, not the server
    init.ts                  `tmuxweb init`
    generate-token.ts         `tmuxweb generate`
    config-command.ts          `tmuxweb config port|host`
    service-command.ts          `tmuxweb service install|uninstall|status`
    upgrade.ts                   `tmuxweb upgrade [--tag <tag>]`
    mcp-command.ts                 `tmuxweb mcp` -- wires mcp/ into real tmux/worktree/hook deps
    app-dir.ts                    `~/.local/share/tmux-web` path resolution
    version.ts                     `tmuxweb --version`
    help.ts                         `tmuxweb help`
bin/
  tmuxweb.ts             CLI entry point (shebang); dispatches into src/cli/
web/
  SolidJS + Vite PWA client (installable on iOS Safari via "Add to Home
  Screen") -- replaced the Kotlin Multiplatform + Compose Multiplatform
  `kmp/` client (deleted in Phase 10, see docs/adr/0004), which had itself
  replaced the original vanilla-JS `public/` frontend and the old
  `ios/TmuxWebClient` SwiftUI app. `npm run build` produces `web/dist`,
  which `src/main.ts`'s `DEFAULT_WEB_BUILD_DIR` serves statically alongside
  the API -- see "Local development" above for running it.
    src/api/           REST client (client.ts) + WebSocket clients
                       (terminalSocket.ts, logsSocket.ts) + Zod-validated
                       domain types (types.ts)
    src/domain/        pure ports of the old kmp/ domain/*.kt logic
                       (fuzzy search, bell alerts, terminal search/clipboard
                       shortcut detection, etc.) -- no DOM, no network
    src/stores/        `createXStore(deps)` state containers (solid-js/store)
                       -- one per screen/feature, DI-testable via injected
                       fakes instead of mocking modules
    src/screens/       screen/dialog components -- mobile-first layouts plus
                       the >=900px desktop "web shell" (sidebar + main pane)
    src/terminal/      the @xterm/xterm binding (TerminalView.tsx) and its
                       supporting DOM wiring (keydown shortcuts, clipboard,
                       touch scroll, search bar) -- the highest-risk area,
                       see this file's live-verification mandate above
    src/ui/            reusable design-system components (Button, TextField,
                       Sheet, ConfirmDialog, etc.) + ui.css
    public/sw.js       service worker (offline shell + Web Push)
  docs/adr/0004-solidjs-pwa-migration.md documents why this replaced kmp/
  and the concrete parity work involved.
scripts/
  install-service.mjs   `npm run install-service` -- thin wrapper around
                        `tmuxweb service install`, for a local dev clone
deploy/
  tmux-web.service     systemd --user unit (manual/reference copy; the
                       generated one from `tmuxweb service install` uses
                       your actual paths and node binary instead of the
                       placeholder path)
docs/testing/
  tmux-web.tdd.md      TDD evidence report (what's tested and how)
```

## What's intentionally NOT here

- No build step / bundler — Node runs the `.ts` sources directly.
- No real database — one JSON file for the project registry, tmux/git
  themselves are the source of truth for everything else.
- No user accounts — one shared token, one server.
- No TLS termination built in — terminate TLS at your VPN/reverse proxy,
  not here. Note that plain HTTP on a non-`localhost` host (the
  WireGuard/Tailscale setup above) is not a browser "secure context", so
  the terminal's Cmd+C copy falls back to the legacy `execCommand`
  API/a manual copy box instead of the modern Clipboard API — it still
  works, but terminating TLS in front of tmux-web makes that copy path
  more consistent across browsers.
- If your `tmux.conf` has `set -g mouse on`, a plain click-drag is sent to
  tmux itself (it goes into tmux's own copy-mode buffer, not your
  clipboard). Hold **Option (⌥) on macOS** or **Shift** on Windows/Linux
  while dragging to select locally in the browser instead — the same
  modifier convention native terminal apps (iTerm2, Terminal.app, xterm)
  use for the same reason.
- No automatic branch deletion — killing a session always keeps the git
  branch (only the worktree checkout is removed), so you don't lose commits
  by accident. Delete branches yourself with plain `git branch -d` when
  you're done with them.
- No diffing algorithm and no diff-rendering library — `git diff` already
  computes hunks; this tool just colors the lines it prints. Untracked
  files have no history to diff against, so they're shown as their raw
  content instead of a real diff.
- No staging actions in the UI (no "stage this file" button) — the changes
  sidebar is read-only visibility. Use the terminal right next to it for
  `git add`/`git commit`/etc.
- Binary-file detection is a heuristic (a NUL byte in the first 8KB, or
  git's own "Binary files ... differ" line) — good enough to avoid dumping
  garbled bytes into the browser, not a rigorous content-type check.
- No environment config editor in the UI — `docker-compose.yml`,
  `pre-run.sh`, and `post-run.sh` are real files in the repo; edit them
  with the terminal right next to the Environment bar, same as any other
  file in the worktree.
- No enforcement that a project's `docker-compose.yml` avoids fixed host
  ports — tmux-web scopes the compose *project name* per session, but two
  sessions of the same project publishing the same hardcoded host port
  will still collide. Use ephemeral publish syntax (see [Per-session
  environments](#per-session-environments-docker-compose)) to avoid this.
- No cancel button mid-setup — if `pre-run.sh`/`docker compose up`/
  `post-run.sh` is taking a while, Stop will still tear down whatever's
  running once it gets there, but there's no way to interrupt a script or
  build already in flight short of stopping tmux-web itself.
