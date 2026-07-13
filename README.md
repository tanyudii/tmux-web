# tmux-web

A small, self-hosted browser GUI for working across projects and tmux
sessions. No cloud account, no relay, no external dependency of any kind —
just your server, git, tmux, and a browser.

The flow mirrors what you'd get from a hosted dev-environment product like
Superset, minus the account/relay: **open a project → it can hold many
sessions → every session is an isolated git worktree** on its own branch,
so parallel sessions never collide on the same working directory.

Built to be read in one sitting: the entire core (`src/`) is around 1700
lines across 16 files, with 4 runtime dependencies (`node-pty`, `ws`,
`@xterm/xterm`, `@xterm/addon-fit`) — the per-session environment feature
below shells out to the `docker`/`docker compose` CLIs already on your
system rather than adding a client library.

## How it works

- **Projects** are just a name + an absolute path to a git repo on the
  server, registered once via the UI and persisted to
  `~/.tmux-web/projects.json`.
- **Sessions belong to a project.** Creating one slugifies the name into a
  branch name, runs `git worktree add -b <branch> ~/.tmux-web/worktrees/<projectId>/<branch>`,
  then starts a real `tmux` session with its working directory set to that
  worktree (`tmux new-session -c <worktree>`). Killing a session kills the
  tmux session, then removes the worktree — but **not** the branch, so your
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
- **Uncommitted changes are protected.** If a worktree has uncommitted
  changes, killing its session is refused (409) until you explicitly
  confirm force-delete in the UI — this tool never silently discards
  work, unlike some worktree-removal defaults elsewhere.
- A single shared token (`TMUX_WEB_TOKEN`) gates every API and WebSocket
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
  published for a configured service and shows an **Open ↗** link. See
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

1. **Never bind it to a public interface.** Use `TMUX_WEB_BIND_HOST` to
   bind only to a private interface — e.g. your WireGuard/Tailscale
   tunnel IP, or `127.0.0.1` behind your own reverse proxy. Do not
   port-forward this on your router.
2. **Run it as a non-root, non-privileged user.** The provided systemd
   unit runs as a `--user` service, not root.
3. **Generate a real token**, not a short/guessable string:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
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

## Setup

```bash
git clone git@github.com:tanyudii/tmux-web.git
cd tmux-web
npm install                 # also copies xterm.js into public/vendor/
cp .env.example .env
# edit .env: set TMUX_WEB_TOKEN (see command above), TMUX_WEB_BIND_HOST

npm test                    # includes real-tmux and real-git integration tests
npm run typecheck

npm start                   # foreground, for a first manual check
```

Open `http://<bind-host>:5309` (or whatever `TMUX_WEB_PORT` you set), paste
the token, click **+ Add project** and point it at an absolute path to a
git repo already on this server, open the project, then **+ New session**
and confirm you land in a real shell whose `pwd` is a freshly created
worktree.

### Data directory

Everything this tool persists lives under `TMUX_WEB_DATA_DIR` (default
`~/.tmux-web`):

```
~/.tmux-web/
  projects.json          registered projects (name, id, repo path)
  worktrees/
    <projectId>/
      <branch-slug>/      one git worktree per active session
```

Nothing here is a database — `projects.json` is a plain JSON array
(atomic write via temp-file + rename), and the worktree directories are
just what `git worktree add` produced. You can `cat`, back up, or hand-edit
either with tools you already trust.

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

## Running as a service (survives reboots and crashes)

```bash
mkdir -p ~/.config/systemd/user
cp deploy/tmux-web.service ~/.config/systemd/user/
# edit WorkingDirectory/EnvironmentFile paths in the unit if you cloned
# somewhere other than ~/go/src/github.com/tanyudii/tmux-web
systemctl --user daemon-reload
systemctl --user enable --now tmux-web
loginctl enable-linger $USER   # keeps it running even when you're logged out
systemctl --user status tmux-web
```

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
  docker-compose.ts        shells out to `docker compose` (up/down/ps/port)
  run-script.ts            runs pre-run.sh/post-run.sh via /bin/sh
  session-env.ts           orchestrates pre-run -> compose up -> post-run per session
  server.ts               HTTP API + auth middleware (testable via injected deps)
  pty-bridge.ts            node-pty <-> WebSocket bridge, resize handling
  config.ts               env var parsing/validation
  main.ts                 composition root: wires the above into a real server
public/
  index.html, app.js   vanilla JS frontend: project list -> project detail
                        (session sidebar, xterm.js, right-hand changes/diff
                        sidebar, environment setup bar above the terminal)
  notify.js             pure bell-alert decision logic (mute state, cooldown,
                        title text) -- DOM-free so it's unit-tested directly
                        with node:test while still loading as a browser
                        ES module, imported by app.js
  vendor/              generated by `npm install` (postinstall), gitignored
deploy/
  tmux-web.service     systemd --user unit
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
  not here.
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
