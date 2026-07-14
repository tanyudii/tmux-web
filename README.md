# tmux-web

[![CI](https://github.com/tanyudii/tmux-web/actions/workflows/ci.yml/badge.svg)](https://github.com/tanyudii/tmux-web/actions/workflows/ci.yml)

A small, self-hosted browser GUI for working across projects and tmux
sessions. No cloud account, no relay, no external dependency of any kind —
just your server, git, tmux, and a browser.

The flow mirrors what you'd get from a hosted dev-environment product like
Superset, minus the account/relay: **open a project → it can hold many
sessions → every session is an isolated git worktree** on its own branch,
so parallel sessions never collide on the same working directory.

Built to be read in one sitting: the entire core (`src/`) is around 1700
lines across 16 files, with 2 runtime dependencies (`node-pty`, `ws`) — the
per-session environment feature below shells out to the `docker`/`docker
compose` CLIs already on your system rather than adding a client library.

The client (web + iOS) is being rebuilt as a single Kotlin Multiplatform +
Compose Multiplatform project under `kmp/` — see
`.claude/plans/rebuild-web-ios-kmp.plan.md` for the in-progress migration
plan. The backend (`src/`) is a frozen contract throughout that migration.

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
  published for a configured service and shows an **Open ↗** link. A
  **Logs** button also appears, streaming `docker compose logs -f` for
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
4. **Audit it yourself.** This is a young, low-adoption project (it's
   yours). Before trusting it with real access, read at minimum:
   `src/auth.ts` (token check), `src/server.ts` (route handling and error
   mapping), `src/worktree.ts` and `src/git-status.ts` (every `git`
   invocation this tool makes, including the diff-endpoint's path-traversal
   guard), and `src/main.ts` (how they're wired together with the WebSocket
   upgrade).
5. **The per-session environment feature extends this trust to Docker.**
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
  read-only access works well) — `npm install -g github:...` shells out to
  `git` under the hood and needs this to clone a private repo.

## Installation (global CLI, production)

Install a specific release tag — recommended for servers, since it pins
exactly what's running:

```bash
npm install -g github:tanyudii/tmux-web#v1.0.0
```

Or track whatever's on the default branch:

```bash
npm install -g github:tanyudii/tmux-web
```

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
tmuxweb upgrade                 # resolves and installs the latest tag
tmuxweb upgrade --tag v1.2.0    # pin to a specific tag
```

Re-runs the same `npm install -g` from above against the resolved tag, then
restarts the systemd service automatically if it was already running.

## Local development

```bash
git clone git@github.com:tanyudii/tmux-web.git
cd tmux-web
npm install
npm run init                 # creates ~/.tmux-web/config.json with a generated token

npm test                    # includes real-tmux and real-git integration tests
npm run typecheck

npm run dev                 # watch mode, or `npm start` for a plain foreground run
```

Open `http://<host>:<port>` (`http://127.0.0.1:5309` by default — see
`~/.tmux-web/config.json`), paste the token, click **+ Add project** and
point it at an absolute path to a git repo already on this server, open the
project, then **+ New session** and confirm you land in a real shell whose
`pwd` is a freshly created worktree.

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
versioned like everything else, and can differ per branch):

```
.tmux-web-env/
  docker-compose.yml   required -- its presence is what makes the
                        "Setup Environment" button appear at all
  env.json              optional -- { "openService": "web", "openPort": 3000 }
  pre-run.sh             optional -- runs before `docker compose up`
  post-run.sh             optional -- runs after `docker compose up`
```

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
4. If `env.json` names an `openService`/`openPort`, resolves the ephemeral
   host port docker published for it (`docker compose port <service>
   <port>`) and shows an **Open ↗** link to `http://<host>:<port>`.

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
  cli/
    index.ts                argv router for the `tmuxweb` command
    init.ts                  `tmuxweb init`
    generate-token.ts         `tmuxweb generate`
    config-command.ts          `tmuxweb config port|host`
    service-command.ts          `tmuxweb service install|uninstall|status`
    upgrade.ts                   `tmuxweb upgrade [--tag <tag>]`
    version.ts                    `tmuxweb --version`
    help.ts                        `tmuxweb help`
bin/
  tmuxweb.ts             CLI entry point (shebang); dispatches into src/cli/
kmp/
  Kotlin Multiplatform + Compose Multiplatform client (web + iOS), replacing
  the old vanilla-JS `public/` frontend and the old `ios/TmuxWebClient`
  SwiftUI app -- see `.claude/plans/rebuild-web-ios-kmp.plan.md` for the
  in-progress migration plan and architecture decisions.
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
- No auto-reconnect on the frontend — closing/reopening a session tab is
  just clicking it again in the sidebar (tmux already kept it alive).
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
