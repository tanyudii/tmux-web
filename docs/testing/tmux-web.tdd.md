# TDD Evidence Report — tmux-web

**Source plan**: no `*.plan.md` file — this project's plan was produced inline
in conversation (a `/plan`-style requirements/risk/step breakdown), then
implemented via `/ecc:tdd-workflow`. User journeys below were written
directly from that plan.

**Runner**: Node's built-in test runner, invoked directly on TypeScript
source via `node --experimental-strip-types --test` (no Jest/Vitest — kept
dependency count minimal for auditability). Coverage via
`--experimental-test-coverage`.

## User journeys

1. As the server owner, I want every API and WebSocket request to require a
   valid shared token, so an unauthenticated request on my network never
   gets shell access.
2. As the server owner, I want to list, create, and kill tmux sessions from
   the browser, so I can manage "workspaces" without SSHing in separately.
3. As the server owner, I want a browser tab I open against a tmux session
   to show the same live PTY output others attached to it would see, and to
   accept my keystrokes, so it behaves like a real terminal.
4. As the server owner, I want resizing my browser window to resize the
   underlying tmux client, so panes render correctly.
5. As the server owner, I want closing the tab (or the server process
   restarting) to detach, not kill, the session, so long-running processes
   inside tmux survive.
6. As the server owner, I want the static frontend served safely — no path
   traversal outside the public directory.
7. As the server owner, I want the process to refuse to start with a missing
   or too-short token, so I can't accidentally deploy it wide open.
8. As the server owner, I want to register a project (a git repo path) once
   and reopen it later, so I don't retype the path every time.
9. As the server owner, I want every new session inside a project to get its
   own git worktree on its own branch, so parallel sessions never collide on
   the same working directory or uncommitted changes.
10. As the server owner, I want killing a session to remove its worktree but
    **keep the branch**, so I never lose committed work by clicking a kill
    button, and I want removal *refused* (not silently forced) if the
    worktree still has uncommitted changes.
11. As the server owner, I want session names and branch names built from
    untrusted input to be safe — no shell injection, no path traversal out
    of the managed worktrees directory, no collision with tmux's own name
    syntax.
12. As the server owner, I want removing a project's registration to warn me
    if it still has active sessions, rather than silently orphaning them.
13. As the server owner, I want a right-hand sidebar showing what's changed
    (staged/unstaged/untracked) in the attached session's worktree, so I can
    review before committing without leaving the browser.
14. As the server owner, I want to click a changed file and see its diff,
    so I don't have to run `git diff` by hand in the terminal.
15. As the server owner, I want the diff/changes endpoints to be as safe as
    every other endpoint — path-traversal-guarded, 404 on a worktree that no
    longer exists, no crash on binary files.
16. As the server owner, I want a one-click way to spin up a scoped
    database + infrastructure sandbox for whatever branch a session is on,
    so I can test my changes against a real running stack without manually
    wiring up docker myself every time.
17. As the server owner, I want each session's environment fully isolated
    from every other session's (its own containers, network, and volumes),
    so two people/branches testing in parallel never corrupt each other's
    data or fight over the same container names.
18. As the server owner, I want the environment setup to run my project's
    own pre-run and post-run scripts (e.g. migrations, seed data), so the
    "one click" produces a working app, not just empty containers.
19. As the server owner, I want to be handed a clickable link to the
    running app once setup finishes, so I don't have to go find which host
    port docker picked myself.
20. As the server owner, I want the environment feature to be entirely
    invisible for projects that haven't opted in, so it doesn't clutter or
    risk anything for repos that don't use it.
21. As the server owner, I want killing a session to always tear down its
    environment too, so I never accumulate orphaned containers/volumes
    just from using this tool normally.
22. As the server owner, I want environment status to always reflect
    docker's actual state, not a stale cache, so the UI never lies to me
    about whether something is really running.

## Task report

| Journey | Summary | Validation command | Result |
|---|---|---|---|
| 1 | `extractBearerToken`/`extractQueryToken`/`verifyToken` implemented with fail-closed, constant-time comparison | `node --experimental-strip-types --test src/auth.test.ts` | RED (14 fail, module missing) → GREEN (14 pass) |
| 1, 2 | HTTP API (`/api/sessions` GET/POST, `/api/sessions/:name` DELETE) enforces auth before touching tmux | `node --experimental-strip-types --test src/server.test.ts` | RED (1 fail) → GREEN (16 pass) |
| 2 | tmux session list parsing, name validation (rejects shell metacharacters, colons, leading dashes, >64 chars), create/kill ops | `node --experimental-strip-types --test src/tmux.test.ts` | RED (1 fail) → GREEN (18 pass) |
| 3, 4, 5 | PTY↔WebSocket bridge: forwards output, applies input/resize messages, kills PTY (detach) on socket close, closes socket on PTY exit | `node --experimental-strip-types --test src/pty-bridge.test.ts` | RED (1 fail) → GREEN (16 pass, incl. 1 real-tmux integration test) |
| 7 | Env config validation (token length, port range, defaults) | `node --experimental-strip-types --test src/config.test.ts` | RED (1 fail) → GREEN (7 pass) |
| 6 | Static file serving from `publicDir`, path-traversal guard, 500 propagation for non-validation errors | `node --experimental-strip-types --test src/server.test.ts` (backfilled after initial coverage run) | GREEN (6 new tests, all pass; no RED phase — characterizes already-correct, manually smoke-tested behavior found via coverage gap) |
| all (v1) | End-to-end wiring (`main.ts`) | Manual smoke test: `curl`/`node -e` script against a live server + real tmux session (see commit `feat: wire server, tmux ops and pty-bridge into main entrypoint`) | PASS — 401 without token, session create/list/delete over real HTTP, live WS round-trip of `echo` through a real tmux session, static assets served, path traversal blocked (404, not file contents) |
| 11 | Branch-name slugification: lowercase, whitespace→dash, strip everything outside `a-z0-9.-` (deliberately excludes `_`, reserved as the session-name separator), collapse/trim dashes and dots, truncate | `node --experimental-strip-types --test src/slug.test.ts` | RED (1 fail) → GREEN (11 pass) |
| 11 | Composite `<projectId>__<slug>` session-name build/parse, incl. tmux's 64-char limit and ambiguous-separator rejection | `node --experimental-strip-types --test src/session-naming.test.ts` | RED (1 fail) → GREEN (12 pass) |
| 9, 10, 11 | `git worktree add/remove` via `execFile` (no shell), path-traversal-guarded path resolution, dirty-worktree vs. branch-conflict error mapping | `node --experimental-strip-types --test src/worktree.test.ts` | RED (1 fail) → GREEN (10 pass, incl. 1 real-git integration test: init a temp repo, add a worktree, confirm remove is refused when dirty and succeeds with `--force`) |
| 8, 12 | Project registry: JSON persistence (atomic write), absolute-path + real-git-repo validation before registering | `node --experimental-strip-types --test src/projects.test.ts` | RED (1 fail) → GREEN (12 pass, incl. 1 real-git integration test) |
| 9, 10 | Orchestration layer (slugify → build name → create worktree → create tmux session with `cwd`; rollback worktree if the tmux side fails; kill session → remove worktree) | `node --experimental-strip-types --test src/project-sessions.test.ts` | RED (1 fail) → GREEN (11 pass) |
| 8, 9, 10, 12 | Project + project-session HTTP routes replace the old flat `/api/sessions` routes entirely; error-type → HTTP-status mapping (`ValidationError`/`ProjectValidationError`→400, `WorktreeConflictError`/`DirtyWorktreeError`→409) | `node --experimental-strip-types --test src/server.test.ts` | RED (15 fail) → GREEN (23 pass), then backfilled to 29 pass after a coverage pass found untested malformed-JSON/500 branches |
| 9, 10 | `main.ts` rewired to compose `projects.ts` + `worktree.ts` + `project-sessions.ts`; new `TMUX_WEB_DATA_DIR` config (default `~/.tmux-web`) | `node --experimental-strip-types --test src/config.test.ts` (config) + manual E2E smoke test (wiring) | RED (2 fail) → GREEN (8 pass); manual: registered a real project, created a session, confirmed the worktree+branch existed on disk *and* the WebSocket terminal's `pwd` was the worktree, killed the session, confirmed worktree gone and branch kept |
| 13, 14, 15 | `git status --porcelain=v1 -z` parsing (staged/unstaged/untracked, `MM`-style combos, renames without misaligning the NUL stream, unmerged fallback), `git diff`/`git diff --cached` pass-through, untracked-file raw read with NUL-byte binary sniffing, path-traversal guard | `node --experimental-strip-types --test src/git-status.test.ts` | RED (1 fail) → GREEN (20 pass, incl. 1 real-git integration test covering staged+unstaged+untracked+binary in one repo) |
| 13, 14 | `getProjectSessionChanges`/`getProjectSessionDiff` resolve `(project, sessionSlug)` → worktree path → delegate to `git-status.ts` | `node --experimental-strip-types --test src/project-sessions.test.ts` | RED (1 fail, compile-time — new exports didn't exist) → GREEN (13 pass) |
| 13, 14, 15 | `GET .../sessions/:name/changes` and `GET .../diff?path=&mode=` routes; `mode` validated against an allowlist; error mapping extended (`WorktreeNotFoundError`→404, `GitStatusError`→400) | `node --experimental-strip-types --test src/server.test.ts` | RED (7 fail) → GREEN (39 pass) |
| 13, 14, 15 | End-to-end changes/diff flow against a live server + real git worktree | Manual smoke test: created staged/unstaged/untracked/binary files in a real worktree, fetched `/changes` and `/diff` over real HTTP, confirmed a `../../../../etc/passwd` `path` param is rejected 400 | PASS — see task report detail below |
| 16, 20 | `.tmux-web-env/` convention reader: `null` (feature unavailable) when `docker-compose.yml` is absent, resolves optional `pre-run.sh`/`post-run.sh`, parses optional `env.json` for `openService`/`openPort` | `node --experimental-strip-types --test src/env-config.test.ts` | RED (1 fail, module missing) → GREEN (7 pass) |
| 17 | `docker compose` exec wrapper (`up -d --build` / `down -v` / `ps --format json` / `port`), every call scoped by `-p <projectName>`, JSON-per-line parsing, failures mapped to `DockerComposeError` | `node --experimental-strip-types --test src/docker-compose.test.ts` | RED (1 fail) → GREEN (9 pass) |
| 18 | `pre-run.sh`/`post-run.sh` executed via `execFile("/bin/sh", [scriptPath], { cwd })` (works without `chmod +x`); failures mapped to `ScriptError`, preferring stderr over the generic error message | `node --experimental-strip-types --test src/run-script.test.ts` | RED (1 fail) → GREEN (3 pass) |
| 16, 17, 18, 19, 22 | Core orchestration (`session-env.ts`): idle/running always re-derived live from `composePs` (never trusted from cache); `start()`/`stop()` eligibility guards (`EnvUnavailableError`, `EnvAlreadyRunningError` for both an in-flight start and already-running containers, `EnvNotRunningError`); pre-run → up → post-run happy path; abort-before-up on pre-run failure; error reported when compose up itself fails; error-with-services-and-openUrl-still-visible when only post-run fails; falls back to `idle` when `composePs` itself throws (e.g. docker daemon unreachable); `stopping` phase observable via a status poll while teardown is still in flight | `node --experimental-strip-types --test src/session-env.test.ts` | RED (1 fail, compile-time) → GREEN (13 pass), then backfilled to 15 pass after a coverage pass found the composePs-failure and mid-teardown gaps |
| 21 | `killProjectSession` calls an optional `stopSessionEnv` dep between `killSession` and `removeWorktree`, best-effort (swallows the dep's own failures so a session with no environment, or a gone docker daemon, still kills cleanly) | `node --experimental-strip-types --test src/project-sessions.test.ts` | RED (1 fail) → GREEN (17 pass) |
| 16, 17, 18, 19, 20, 21, 22 | `GET/POST/DELETE /api/projects/:id/sessions/:slug/env` routes; `POST` awaits only the fast eligibility checks (not the full docker-compose setup), returning 202 so a multi-minute build/pull never blocks the HTTP response — progress is observed by polling `GET`; error mapping extended (`EnvUnavailableError`→404, `EnvAlreadyRunningError`/`EnvNotRunningError`→409) | `node --experimental-strip-types --test src/server.test.ts` | RED (8 fail) → GREEN (51 pass) |
| all (env) | `main.ts` wires a single process-lifetime `SessionEnvDeps`+`SessionEnvStore` (mirroring the existing single `WebSocketServer` instance) into both `ServerDeps` and `ProjectSessionsDeps.stopSessionEnv` | `npm run typecheck` + full suite | GREEN — pure composition wiring (same no-unit-test rationale as the rest of `main.ts`, see below); full 220-test suite passed unchanged immediately after wiring |
| 16, 17, 18, 19, 20, 21 | End-to-end environment lifecycle against a live server + a real Docker daemon | Manual smoke test: created a scratch git repo with `.tmux-web-env/docker-compose.yml` (`nginx:alpine` serving a static page via an ephemeral `127.0.0.1::80` port), `env.json` (`openService`/`openPort`), and `pre-run.sh`/`post-run.sh`; registered it as a project and drove the exact HTTP endpoints `app.js` calls | PASS — see detail below |

`main.ts` (the composition root) is deliberately **not** unit-tested — it is
pure wiring (env → deps → `createServer`/`attachPtyToSocket`) with no
branching logic of its own; all of its logic branches live in the modules
it wires together, which are unit-tested. It was instead verified by
running the real process and driving it with real HTTP/WebSocket clients
against a real tmux session and a real git repo (see task report above).

## Bug found via manual smoke testing (not caught by unit tests)

The force-retry flow (kill a session with a dirty worktree → 409 → user
confirms force-delete → retry) 500'd instead of succeeding, **only** when
the session being killed was the *last* tmux session on the box. Unit
tests for `killProjectSession`'s idempotent-retry logic used a fake
`killSession` that rejected with `"can't find session: <name>"` — the
message tmux gives when its server is still running but that particular
session is gone. But when a session's death is also the *server's* last
session, tmux's server process exits entirely, and a follow-up
`tmux kill-session` instead fails with `"no server running on ..."` — a
completely different string my regex didn't match.

This was only found by actually running the flow end-to-end (create a
session, dirty its worktree, kill without force → 409, kill with force →
expected 204, got 500) — the unit tests were internally consistent but
tested the wrong assumption about tmux's error message. Fixed by widening
`SESSION_ALREADY_GONE_PATTERN` to also match `no server running`, with a
regression test added first (RED → GREEN) that reproduces the exact
message tmux emits in that situation.
This is the reason the manual E2E smoke test step is not optional for this
project, even with 98%+ line coverage: coverage measures whether a branch
ran, not whether the fake inputs to that branch matched what the real
dependency actually says.

## Manual smoke test: per-session environments

Every `docker`/`docker compose` call in `session-env.ts` is unit-tested
against a fake `exec`, same as `tmux.ts`/`worktree.ts`/`git-status.ts`
elsewhere in this project — which proves the *argv construction and
control flow* are correct, but not that a real Docker daemon actually
behaves the way the fakes assume. So this feature was additionally driven
end-to-end against a live server (`node --experimental-strip-types
src/main.ts`) and a real Docker daemon already running on the build
machine (shared with unrelated containers — the isolation the feature
promises was itself part of what got verified):

1. Created a scratch git repo with `.tmux-web-env/docker-compose.yml`
   (`nginx:alpine` serving a static `www/index.html`, published as
   `127.0.0.1::80` — the ephemeral-port convention this README
   recommends), `env.json` (`{"openService":"web","openPort":80}`), and
   `pre-run.sh`/`post-run.sh` that just echo to stderr.
2. Registered it as a project and created a session over real HTTP
   (`POST /api/projects`, `POST /api/projects/:id/sessions`) — the exact
   calls `app.js` makes.
3. `GET .../env` on the fresh session → `{"phase":"idle"}`, confirming the
   convention folder is detected.
4. `POST .../env` → `202`; an immediate follow-up `GET` → `{"phase":
   "starting"}`, confirming the HTTP layer returns before the docker-compose
   setup finishes.
5. Polled `GET .../env` every second; after 4 polls (~4s, including image
   pull/start) → `{"phase":"running","openUrl":"http://localhost:32768",
   "services":[{"service":"web","state":"running"}]}`.
6. `curl`'d the resolved `openUrl` directly → got back the exact demo
   page content, confirming the ephemeral port resolution
   (`docker compose port`) points at the right container.
7. `docker ps --filter label=com.docker.compose.project=<projectId>__<slug>`
   showed exactly one container, named `<projectId>__<slug>-web-1` —
   confirming the compose-project-name scoping actually isolates this
   session's stack the way the design intends.
8. `DELETE .../env` → `204`; a follow-up `GET` → back to `{"phase":
   "idle"}`; `docker ps -a` for that compose project → empty (containers
   *and* volumes gone, not just stopped).
9. Started the environment again, then killed the **session** directly
   (`DELETE /api/projects/:id/sessions/:slug?force=true`) *without*
   stopping the environment first — confirmed via `docker ps -a` that the
   container was torn down anyway (the `killProjectSession` auto-teardown
   wiring), with no orphaned container left behind.
10. Registered a second project with **no** `.tmux-web-env/` folder at
    all → `GET .../env` on its session returned `{"phase":"unavailable"}`,
    confirming the feature stays fully invisible for repos that haven't
    opted in.

All ten steps passed on the first run — no defects found. Test resources
(scratch repos, the verification server, and every container it created)
were fully cleaned up afterward; `docker ps -a` and `tmux list-sessions`
were confirmed to show none of this session's test artifacts, and the
pre-existing, unrelated containers already running on the shared build
machine were left untouched throughout.

**Frontend caveat**: no Chrome (or any other) browser binary is installed
in this build environment, so the actual env-bar DOM — the status badge,
button visibility per phase, and the Open link — was **not** driven
through a real rendered page or clicked through, the same limitation this
report already discloses for the changes-sidebar frontend below. `app.js`
was syntax-checked (`node --check`) and its `fetch` calls target the exact
endpoints exercised in steps 3-10 above, but the DOM rendering itself is
unverified. Flagged explicitly rather than overclaiming.

## Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|---|---|---|---|
| 1 | Missing/wrong/malformed `Authorization` header is rejected | `src/auth.test.ts` | unit | PASS |
| 2 | A misconfigured server (empty expected token) never grants access | `src/auth.test.ts:verifyToken fails closed when the expected token is empty` | unit | PASS |
| 3 | Session names with shell metacharacters, colons, leading dashes, or >64 chars are rejected before any `tmux` command runs | `src/tmux.test.ts` | unit | PASS |
| 4 | `listSessions` treats "no server running" as zero sessions, not an error | `src/tmux.test.ts:listSessions returns an empty array when tmux reports no server running` | unit | PASS |
| 5 | `GET /api/sessions` returns 401 without a valid token, 200 with one | `src/server.test.ts` | integration (real HTTP server, ephemeral port) | PASS |
| 6 | `POST /api/sessions` rejects invalid names with 400, malformed JSON with 400, and never calls `createSession` when unauthorized | `src/server.test.ts` | integration | PASS |
| 7 | Non-validation errors from tmux ops surface as 500, not silently swallowed | `src/server.test.ts:propagates unexpected (non-validation) errors as 500` (×2) | integration | PASS |
| 8 | Static file serving resolves `/` to `index.html` and refuses to serve outside `publicDir` | `src/server.test.ts:serves static files...` / `...path-traversal attempt...` | integration | PASS |
| 9 | PTY output is forwarded to the socket only while it's open | `src/pty-bridge.test.ts` | unit (fake PTY + fake socket) | PASS |
| 10 | Closing the socket kills the PTY client (tmux detach semantics), not the session | `src/pty-bridge.test.ts:kills the pty when the socket closes` | unit | PASS |
| 11 | A real `tmux attach-session` PTY actually streams real session output end to end | `src/pty-bridge.test.ts:real tmux integration...` | integration (real tmux binary; skipped if absent) | PASS |
| 12 | Startup refuses a missing/short token or an out-of-range port | `src/config.test.ts` | unit | PASS |
| 13 | Slugification strips shell/path metacharacters (incl. `../../etc`-style traversal attempts) down to a safe `a-z0-9.-` charset | `src/slug.test.ts` | unit | PASS |
| 14 | A worktree path can never resolve outside its project's worktree root, even if given a crafted branch name or project id | `src/worktree.test.ts:resolveWorktreePath rejects...` (×2) | unit | PASS |
| 15 | `git worktree add` is preceded by `git worktree prune`; branch-already-exists is a distinct, catchable error type (`WorktreeConflictError`) | `src/worktree.test.ts` | unit | PASS |
| 16 | Removing a worktree with uncommitted changes is refused (`DirtyWorktreeError`) unless `--force` is passed | `src/worktree.test.ts` + real-git integration test | unit + integration | PASS |
| 17 | Registering a project rejects a non-absolute path and a path that isn't a real git repo, before ever writing to the registry | `src/projects.test.ts` | unit + real-git integration | PASS |
| 18 | Creating a project session rolls back the worktree (force-removed) if the tmux side fails, so a partial failure never leaves an orphaned worktree | `src/project-sessions.test.ts:rolls back the worktree if creating the tmux session fails` | unit | PASS |
| 19 | A force-retry kill tolerates the session already being gone, including the "no server running" case (see bug report below) | `src/project-sessions.test.ts` (×2) | unit | PASS |
| 20 | Every project-scoped route (`/api/projects*`) enforces the token before touching any dependency | `src/server.test.ts:project routes without a token return 401...` | integration | PASS |
| 21 | Deleting a project with active sessions is refused (409) unless `force=true` | `src/server.test.ts` (×2) | integration | PASS |
| 22 | A file staged AND further modified (`MM`) appears once in `staged` and once in `unstaged` | `src/git-status.test.ts:emits two entries for a file staged AND further modified` | unit | PASS |
| 23 | A rename entry's extra NUL-separated old-path field is consumed correctly, so parsing doesn't misread the next file in the stream | `src/git-status.test.ts:stays aligned for entries after a rename` | unit | PASS |
| 24 | A binary diff (`Binary files ... differ`) never has its raw (garbled) bytes returned to the client | `src/git-status.test.ts:detects a binary diff...` + real-git integration | unit + integration | PASS |
| 25 | An untracked binary file is detected via a NUL byte in its first 8KB, without ever passing raw bytes as if they were diff text | `src/git-status.test.ts:detects an untracked binary file...` | unit + real-fs | PASS |
| 26 | `getChangedFiles`/`getFileDiff` reject a `filePath` that resolves outside the worktree | `src/git-status.test.ts:getFileDiff rejects a path that escapes...` | unit | PASS |
| 27 | `getChangedFiles` returns 404-mappable `WorktreeNotFoundError` for a worktree directory that doesn't exist (e.g. a killed session) | `src/git-status.test.ts:throws WorktreeNotFoundError...` | unit | PASS |
| 28 | The `/diff` route rejects a missing `path` or an invalid `mode` before calling any dependency | `src/server.test.ts:returns 400 when path is missing` / `...when mode is invalid` | integration | PASS |
| 29 | `loadEnvConfig` returns `null` (feature unavailable) when `.tmux-web-env/docker-compose.yml` is absent, and rejects a malformed `env.json` or wrong-typed `openService`/`openPort` before ever returning a config | `src/env-config.test.ts` | unit + real-fs | PASS |
| 30 | Every `docker compose` invocation (`up`/`down`/`ps`/`port`) is scoped by `-p <projectName>`, never built via shell string concatenation | `src/docker-compose.test.ts` | unit | PASS |
| 31 | `composePort` returns `null` (not an error) when a service simply doesn't publish the requested port, distinct from a real docker failure | `src/docker-compose.test.ts:composePort returns null when the service publishes no port` | unit | PASS |
| 32 | `startSessionEnv` refuses to start when the environment is already starting *or* already has live containers, before touching pre-run/compose at all | `src/session-env.test.ts:startSessionEnv throws EnvAlreadyRunningError...` (×2) | unit | PASS |
| 33 | A pre-run script failure aborts before `docker compose up` is ever called | `src/session-env.test.ts:startSessionEnv aborts before compose up when pre-run fails` | unit | PASS |
| 34 | Environment status is always re-derived from a live `composePs` call rather than trusted from the in-memory store, so a container stopped outside tmux-web is reflected on the next poll | `src/session-env.test.ts:getSessionEnvStatus derives 'running'...without needing a prior start()` | unit | PASS |
| 35 | `killProjectSession` still removes the worktree even when tearing down its environment fails | `src/project-sessions.test.ts:killProjectSession tolerates stopSessionEnv failing...` | unit | PASS |
| 36 | The full environment lifecycle (opt-in detection, isolated scoping, ephemeral port resolution, teardown, auto-teardown on kill, opt-out invisibility) behaves correctly against a real Docker daemon, not just fakes | manual smoke test (see above) | integration (real Docker + real HTTP) | PASS |
| 37 | Two genuinely concurrent `startSessionEnv` calls for the same session can never both proceed — exactly one is rejected `EnvAlreadyRunningError`, and `docker compose up` runs at most once | `src/session-env.test.ts:startSessionEnv rejects a second truly concurrent start()...` | unit (`Promise.allSettled` on two un-awaited calls) | PASS |
| 38 | A malformed `env.json` surfaces as 400 (`EnvConfigError`) on every verb of the env route, including `GET`, instead of falling through to a generic 500 | `src/server.test.ts:...returns 400 for a malformed env.json (EnvConfigError)` (×2, GET+POST) | integration | PASS |

## Security review

A `security-reviewer` agent pass (mandatory per this project's review
standards for code touching file-system operations, external process
execution, and network-facing endpoints) was run against the full diff
after the feature was otherwise complete. It found no CRITICAL/HIGH
issues — command injection, path traversal, per-route auth, the
frontend's `Open` link construction, and compose-project-name collision
safety all came back clean, each confirmed by reading the relevant code
alongside this project's own existing patterns (`execFile` array args,
`resolveWorktreePath`'s containment check, `buildSessionName`'s
separator-collision guard). Two lower-severity findings were fixed,
each via its own RED → GREEN cycle:

- **MEDIUM — TOCTOU race in `startSessionEnv`** (`src/session-env.ts`):
  the store slot was claimed *after* an `await safeComposePs(...)`, not
  before, so two concurrent start requests for the same session could
  both pass the "already starting" guard and both run pre-run/compose
  up/post-run. Reproduced first with two genuinely concurrent calls via
  `Promise.allSettled` (RED: both fulfilled, `composeUp` called twice),
  fixed by claiming the slot synchronously immediately after the guard
  check, before any further `await` (GREEN, test 37 above). See commits
  `test: reproduce TOCTOU race in startSessionEnv (RED)` /
  `fix: close TOCTOU race in startSessionEnv (GREEN)`.
- **LOW — `EnvConfigError` unmapped, `GET .../env` missing a try/catch**
  (`src/server.ts`): a malformed `env.json` fell through to a generic 500
  instead of the 400 every other validation-style error on this route
  gets, and the `GET` handler in particular had no try/catch at all
  around its dependency call, unlike its `POST`/`DELETE` siblings.
  Reproduced first (RED: both surfaced as 500), fixed by adding
  `EnvConfigError` to `sendMappedError` and wrapping the `GET` handler's
  call the same way as `POST`/`DELETE` (GREEN, test 38 above). See
  commits `test: reproduce EnvConfigError falling through to 500 (RED)` /
  `fix: map EnvConfigError to 400 and guard GET .../env consistently
  (GREEN)`.

The changes-sidebar **frontend** (`public/app.js`'s tree-building, accordion-diff-toggle, and 5s polling) is not unit-tested — same rationale as the rest of the frontend in this project (no browser test framework, no build step). Verified via: JS syntax check (`node --check`), a full DOM-id cross-reference against `index.html`, and the API/WS layers it calls being independently verified end-to-end (see task report). No GUI browser is installed on the deployment server this was built on, so the actual click/render behavior was not driven through a real browser session — flagged explicitly rather than overclaiming. The environment-bar frontend added in this feature (status badge, Setup/Stop/Open) carries the exact same caveat — see "Frontend caveat" above.

## Coverage

```
npm run test:coverage
```

```
all files            |  98.39 |    94.86 |   94.97 |
auth.ts              |  92.86 |    94.12 |  100.00 | (16-17 uncovered)
config.ts            | 100.00 |   100.00 |  100.00 |
docker-compose.ts    |  97.35 |    84.00 |   90.00 | (8-10 uncovered)
env-config.ts        | 100.00 |    85.19 |  100.00 |
git-status.ts         |  97.60 |    95.92 |  100.00 | (152-155 uncovered)
project-sessions.ts  |  98.52 |    86.96 |   87.50 | (40-41 uncovered)
projects.ts          |  97.67 |    90.00 |  100.00 | (33-34 uncovered)
pty-bridge.ts        |  91.49 |    92.00 |   85.71 | (45-52 uncovered)
run-script.ts        |  83.33 |    83.33 |   50.00 | (12-18 uncovered)
server.ts            |  96.30 |    89.78 |  100.00 | (201-202, 245-246, 270-271, 289-290, 301-302, 310-311 uncovered)
session-env.ts       | 100.00 |    93.18 |  100.00 |
session-naming.ts    | 100.00 |   100.00 |  100.00 |
slug.ts              | 100.00 |   100.00 |  100.00 |
tmux.ts              | 100.00 |   100.00 |  100.00 |
worktree.ts          |  94.59 |    78.26 |   88.89 | (19-20, 84-85, 109-110 uncovered)
```

225 tests total, 0 failures, 0 skipped (the real-tmux and real-git
integration tests both ran — tmux 3.6 and git were present on the build
machine; each self-skips via an availability check when its binary is
absent). There is no automated real-Docker integration test analogous to
those — Docker availability varies more than tmux/git across deployment
targets, so the real-Docker path was instead verified once, thoroughly,
via the manual smoke test above rather than gated into the default
`npm test` run.

### Known, intentional gaps

- **`pty-bridge.ts` lines 45-52 (`defaultSpawnPty`)**, **`auth.ts` lines
  16-17** (an unparsable-URL catch branch), **`main.ts`** (pure composition
  root): unchanged from before this feature — see the original notes below.
- **`worktree.ts` lines 19-20 / 84-85 / 109-110**: the "resolved path
  escapes the worktrees root" guards, and the generic (non-conflict,
  non-dirty) `WorktreeError` catch-all branches. Not directly hit because
  `resolveWorktreePath` is always called with an already-`slugifyBranchName`-cleaned
  string in practice, which by construction can't contain `..` — the guard
  is defense-in-depth against a future caller that skips slugification, not
  a path this codebase's own routes can currently reach. Verified logically
  rather than by test; low value to force with a synthetic caller.
- **`projects.ts` line 33-34 / `project-sessions.ts` line 36-37**: the
  `else` branch of an `error instanceof Error ? error.message : String(error)`
  fallback, for the case something throws a non-`Error` value. Not naturally
  reachable through this codebase's own error paths (everything thrown here
  is an `Error` subclass); kept as defensive code, not worth a synthetic
  `throw "string"` test.
- **`server.ts` lines 182-183 / 226-227 / 251-252**: three more instances of
  the "field present but wrong type" validation shape (already covered once
  for `POST /api/projects/:id/sessions`'s `name`), now repeated for the
  changes/diff routes' equivalents. Same low-marginal-value reasoning.
- **`git-status.ts` lines 152-155**: the `getFileDiff` catch branch for a
  `readFile` failure on an untracked file that passed the path-traversal
  guard but still can't be read (e.g. a permissions error, or a symlink to
  a deleted target). Requires a filesystem-level failure mode that's
  awkward to construct portably in a test; the branch exists so such a
  failure surfaces as a clear 400 instead of an unhandled rejection.
- **`docker-compose.ts` lines 8-10 / `run-script.ts` lines 12-18**: each
  module's `defaultExec` (the real `execFileAsync` wrapper used when no
  fake is injected). Same shape as `tmux.ts`/`worktree.ts`/`git-status.ts`'s
  own `defaultExec` gaps elsewhere in this project — every unit test
  injects a fake `exec`, and the real wrapper is instead exercised by the
  manual smoke test above (a real server, calling real `docker`/`sh`).
- **`server.ts` lines 289-290 / 301-302 / 310-311**: the env routes'
  (GET/POST/DELETE) `throw error` fallback for an error `sendMappedError`
  doesn't recognize (surfacing as a generic 500). Same "unmapped error
  falls through to 500" shape already left uncovered for the changes/diff
  routes (lines 245-246/270-271, themselves unchanged from before this
  feature) — this project already has one dedicated test proving that
  shape works (`propagates unexpected (non-validation) errors as 500` on
  the original session routes); adding a copy for every subsequent route
  was judged low marginal value. (`EnvConfigError` specifically *is* now
  covered — see test 38 above — this gap is only the truly-unmapped,
  truly-unexpected-error case.)
- **`env-config.ts`** (85.19% branch, 100% lines): every line executes,
  but not every optional-field combination in `env.json` (e.g. an object
  with neither `openService` nor `openPort` present, vs. the manifest file
  missing outright) is exercised by a distinct test. Both outcomes are
  covered logically by existing tests; not chased further given the low
  complexity of the code involved.

None of these gaps are at the journey level — every user journey above has
at least one PASS-ing automated test, and the safety-relevant "gaps"
(`pty-bridge.ts`'s spawn wiring, `main.ts`'s composition, and this
feature's real-`docker`/real-`sh` execution paths) were all additionally
exercised through real, live manual smoke tests end to end.

## Feature addendum: bell-based tab notifications

**Source plan**: no `*.plan.md` file — produced inline via `/ecc:plan`
(requirements/risk/step breakdown grounded in the existing codebase),
implemented via `/ecc:tdd-workflow`.

### User journeys

16. As the developer, I want tmux-web to alert me (sound + tab title) when
    the attached session's terminal rings the bell while I'm not looking at
    the tab, so I notice when Claude Code has a question, needs
    confirmation, or finished a task — without polling the tab myself.
17. As the developer, I want to mute this per my own preference, and to
    never be alerted twice for the same burst of bells, so it doesn't
    become noise.

### Task report

| Journey | Summary | Validation command | Result |
|---|---|---|---|
| 16, 17 | `parseMuted`/`buildBellTitle`/`shouldPlayBellAlert` — pure, DOM-free decision logic extracted into `public/notify.js` so it can be unit-tested with `node:test` while still loading as a browser ES module (no bundler) | `node --experimental-strip-types --test public/notify.test.js` | RED (`ERR_MODULE_NOT_FOUND`, 1 fail) → GREEN (11 pass) |
| 16, 17 | `npm test`/`npm run test:coverage` extended to include `public/*.test.js` alongside the existing `src/*.test.ts` glob | `npm test` | GREEN (185 pass, 0 fail — 174 pre-existing backend + 11 new) |
| 16 | `public/app.js` wired to `term.onBell()` (via `bellStyle: "none"` on the xterm.js `Terminal` so its own beep doesn't double up), calls `handleBell()` which flashes `document.title`, and — only when `shouldPlayBellAlert` says the tab is away — plays a Web Audio beep and fires a `Notification` | `node --check public/app.js` + manual DOM-id cross-reference against `index.html` | PASS (syntax clean; every `getElementById` call in `app.js` has a matching `id` in `index.html`, including the new `#toggle-notify`) |
| 17 | `#toggle-notify` button toggles a `localStorage`-persisted mute flag and requests `Notification` permission on enable (a user gesture) | same as above | PASS (syntax + DOM-id cross-reference); not driven through a real browser — see gap note below |

### Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|---|---|---|---|
| 29 | No stored preference (`null`/`undefined`) defaults to **not muted** | `public/notify.test.js:parseMuted returns false when no preference has been stored yet` | unit | PASS |
| 30 | Only the exact string `"true"` is read back as muted — no truthy-string surprises | `public/notify.test.js:parseMuted returns true only for the exact stored string "true"` / `...false for "false" or any unrecognized value` | unit | PASS |
| 31 | The flashed tab title always names the session that rang the bell | `public/notify.test.js:buildBellTitle includes the session name...` | unit | PASS |
| 32 | A missing/empty session name falls back to a generic label instead of an empty or malformed title | `public/notify.test.js:buildBellTitle falls back to a generic label...` | unit | PASS |
| 33 | Muting suppresses the alert unconditionally, even when the tab is hidden | `public/notify.test.js:shouldPlayBellAlert never alerts while muted...` | unit | PASS |
| 34 | A focused, visible tab never alerts (no point — the developer is already looking at it) | `public/notify.test.js:shouldPlayBellAlert stays quiet when the tab is focused and visible` | unit | PASS |
| 35 | A hidden tab alerts on the first bell | `public/notify.test.js:shouldPlayBellAlert fires on the first bell when the tab is hidden` | unit | PASS |
| 36 | A visible-but-unfocused tab (e.g. another window has focus) also alerts, not just a fully hidden one | `public/notify.test.js:shouldPlayBellAlert fires when the tab is visible but the browser window lost focus` | unit | PASS |
| 37 | A second bell inside the cooldown window is suppressed, so a burst doesn't stack beeps | `public/notify.test.js:shouldPlayBellAlert suppresses a repeat alert inside the cooldown window` | unit | PASS |
| 38 | A bell after the cooldown has fully elapsed (boundary: `now - lastAlertAt === cooldownMs`) alerts again | `public/notify.test.js:shouldPlayBellAlert allows a repeat alert once the cooldown has fully elapsed` | unit | PASS |
| 39 | `pty-bridge.ts` already forwards arbitrary PTY output (any bytes, including control characters like BEL) to the socket unmodified — no new backend test needed, this is the same contract `attachPtyToSocket forwards pty output to the socket` (`src/pty-bridge.test.ts:119`) already proves generically | `src/pty-bridge.test.ts` | unit (pre-existing) | PASS |

### Coverage

```
npm run test:coverage
```

```
public/notify.js          | 100.00 | 100.00 | 100.00 |
public/notify.test.js     | 100.00 | 100.00 | 100.00 |
all files                 |  98.34 |  95.53 |  95.45 |
```

185 tests total (174 pre-existing + 11 new), 0 failures.

### Known, intentional gap

- **`public/app.js`'s bell-handling DOM wiring** (`term.onBell` registration,
  `#toggle-notify` click handler, `Notification`/`AudioContext` calls,
  title-flash/restore listeners) is **not unit-tested** — same rationale as
  the rest of this project's frontend (see the changes-sidebar section
  above): no browser test framework, no build step. It was verified via
  `node --check`, a full DOM-id cross-reference against `index.html`, and
  by construction delegates every actual *decision* (mute state, cooldown,
  title text) to the fully-tested `notify.js` functions above — the
  wiring itself only calls them and touches the DOM, mirroring why
  `main.ts` is left untested elsewhere in this report. No GUI browser is
  installed on the machine this was built on, so the real sound/desktop
  notification behavior was not driven through an actual browser session;
  flagged explicitly rather than overclaiming. **Manual verification still
  needed**: attach to a session, switch to another tab, run `printf '\a'`
  inside it (or let Claude Code ring it via `preferredNotifChannel:
  terminal_bell`), and confirm the beep, title flash, and — if permission
  was granted — the desktop notification all appear.

## Feature addendum: new session worktrees branch from origin's default branch

**Source plan**: no `*.plan.md` file — produced inline via `/ecc:plan`
(requirements/risk/step breakdown grounded in the existing codebase, plus
two `AskUserQuestion` design decisions: always `fetch` from `origin` before
creating a worktree, and auto-detect `origin`'s default branch instead of
hardcoding `"main"`), implemented via `/ecc:tdd-workflow`.

### User journeys

23. As the server owner, I want a new session's worktree to branch off
    `origin`'s default branch, not whatever happens to be checked out
    locally in the project's repo, so a new session never inherits
    uncommitted or unpushed local state by accident.
24. As the server owner, I want this to work for repos whose default
    branch isn't literally named `main` (e.g. `master`, `trunk`), so the
    behavior isn't hardcoded to one naming convention.
25. As the server owner, if `origin` can't be reached or resolved (no
    remote, no network), I want session creation to fail with a clear
    error instead of silently falling back to local `HEAD`.

### Task report

| Journey | Summary | Validation command | Result |
|---|---|---|---|
| 24, 25 | New `resolveOriginDefaultBranch()` in `src/worktree.ts` runs `git ls-remote --symref origin HEAD` and parses the `ref: refs/heads/<branch>\tHEAD` line to get the remote's actual default branch name (no hardcoded `"main"`); throws `WorktreeError` if `origin` is unreachable or the symref line is missing/unparsable | `node --experimental-strip-types --test src/worktree.test.ts` | RED (compile error: `resolveOriginDefaultBranch` not exported) → GREEN (17 pass) |
| 23, 25 | `addWorktree()` now: prune → resolve origin's default branch → `git fetch origin <branch>:refs/remotes/origin/<branch>` (explicit refspec, independent of the repo's configured fetch refspec) → `git worktree add --no-track -b <branch> <path> origin/<branch>` (was: `... HEAD`). Fetch failure surfaces as `WorktreeError`; a branch-name conflict on the `add` step still surfaces as `WorktreeConflictError` as before | `node --experimental-strip-types --test src/worktree.test.ts` | GREEN (17 pass, 0 fail) |
| 23, 24 | Real-git integration test rewritten: creates a bare-ish `origin` repo with `--initial-branch=trunk` (a non-`"main"` name, to prove auto-detection isn't hardcoded), clones it, then adds a **local-only commit never pushed to origin**, and asserts the new worktree's file content matches `origin`'s content, not the local-only commit | `node --experimental-strip-types --test src/worktree.test.ts` | GREEN — worktree content equals `"from origin\n"`, never `"local-only change\n"` |
| 23 | `README.md` "How it works" section updated to describe the `ls-remote`/`fetch`/`origin/<branch>` flow instead of implying `HEAD` | manual read-through | PASS |
| — | Full backend suite unaffected by this change | `npm test` | GREEN except 1 pre-existing, unrelated failure (`src/pty-bridge.test.ts` — `node-pty` native module not installed in this worktree's `node_modules`; verified present on the pre-change commit too, not a regression) |

### Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|--------------------|-----------|------|--------|
| 40 | `origin`'s default branch name is parsed correctly from `git ls-remote --symref origin HEAD` output | `src/worktree.test.ts:resolveOriginDefaultBranch parses the branch name from...` | unit | PASS |
| 41 | The parse is not hardcoded to `"main"` — a remote default branch named `"trunk"` (or anything else) resolves correctly | `src/worktree.test.ts:resolveOriginDefaultBranch is not hardcoded to 'main'...` | unit | PASS |
| 42 | Output missing the `ref:` symref line (unparsable) throws `WorktreeError` instead of silently returning `undefined`/a bad branch name | `src/worktree.test.ts:resolveOriginDefaultBranch throws WorktreeError when the symref line is missing...` | unit | PASS |
| 43 | `origin` unreachable (no remote, no network) throws `WorktreeError`, not an unhandled rejection | `src/worktree.test.ts:resolveOriginDefaultBranch throws WorktreeError when ls-remote against origin fails` | unit | PASS |
| 44 | `addWorktree` prunes, resolves the default branch, fetches it with an explicit refspec, then creates the worktree from `origin/<branch>` — exact call order and arguments asserted | `src/worktree.test.ts:addWorktree prunes, resolves origin's default branch, fetches it, then adds a worktree based on origin/<branch>` | unit | PASS |
| 45 | Failure to resolve the default branch aborts session creation with `WorktreeError` before any fetch/add is attempted | `src/worktree.test.ts:addWorktree throws WorktreeError when it cannot resolve origin's default branch` | unit | PASS |
| 46 | Failure to fetch `origin/<branch>` aborts session creation with `WorktreeError` | `src/worktree.test.ts:addWorktree throws WorktreeError when fetching origin's default branch fails` | unit | PASS |
| 47 | A `worktree add` failure that isn't a branch-name conflict still surfaces as a plain `WorktreeError` (not miscategorized as `WorktreeConflictError`) | `src/worktree.test.ts:addWorktree throws WorktreeError for a worktree-add failure that isn't a branch conflict` | unit | PASS |
| 48 | An existing branch name still throws `WorktreeConflictError`, unchanged from prior behavior | `src/worktree.test.ts:addWorktree throws WorktreeConflictError when the branch already exists` | unit | PASS |
| 49 | End-to-end with real `git`: a new worktree's content matches `origin`'s default branch (`"trunk"`, non-`"main"`), not a local-only unpushed commit; `git worktree list` shows the new branch; dirty-removal protection and `--force` removal still work | `src/worktree.test.ts:real git integration: add creates a worktree from origin's default branch (not local HEAD)...` | integration (real `git`, skipped if `git` unavailable) | PASS |

### Coverage

```
node --experimental-strip-types --test --experimental-test-coverage src/worktree.test.ts
```

```
worktree.ts       |  97.22 |    93.94 |   90.00 | 19-20 142-143
```

Remaining uncovered lines (`19-20`: `defaultWorktreesRoot`'s body; `142-143`:
`removeWorktree`'s generic-error fallback) predate this change and are out
of scope for it.

### Known, intentional gap

- **`npm run typecheck`** currently fails across the whole project (not
  just files touched here) with `Cannot find module 'node:*'` /
  `Cannot find name 'process'/'Buffer'` errors, because this worktree's
  `node_modules` does not have `@types/node` installed (`node_modules`
  has a single entry). Verified via `git stash` that this is true on the
  pre-change commit as well — a pre-existing environment gap in this
  checkout, not a regression introduced by this change. Likewise
  `src/pty-bridge.test.ts` fails for the same reason (`node-pty` native
  module absent). Neither is caused by or related to the
  `origin`-default-branch change; both are dependency-installation issues
  for whoever runs `npm install` in this worktree next.

## Feature addendum: visible feedback for the terminal's Cmd+C copy

**Source plan**: no `*.plan.md` file — produced inline via `/ecc:plan`
after the user reported that the prior Cmd+C fix (see "not-selectable
terminal" work, commit `73be7a0`) still didn't let them copy from the
real deployment. That prior fix was only ever unit-tested against the
pure `isCopyShortcut` decision function; it had no live-browser
verification, so there was no way to tell a silent success from a silent
failure. This addendum closes that gap.

### User journeys

26. As a user on a plain-HTTP, non-`localhost` deployment (this app's own
    README recommends exactly that: bind to a WireGuard/Tailscale tunnel
    IP), I want to know whether Cmd+C actually copied my terminal
    selection, instead of silent, unverifiable behavior either way.
27. As that same user, if automatic copy fails for any reason (insecure
    context blocks `navigator.clipboard`, and/or the browser blocks
    `execCommand("copy")`), I want a guaranteed-to-work fallback: a
    normal, focused, pre-selected text field I can Cmd+C from directly,
    since the browser's native copy handling for editable elements isn't
    gated by any of the above.

### Investigation before implementing

Live-reproduced the user's exact reported conditions — server bound to
this machine's real WireGuard interface IP (`10.8.0.2`, plain HTTP, not
`localhost`) and driven with a real Chromium (Playwright-driven, since no
`chrome-devtools` MCP browser was available in this environment) — before
writing any fix, to avoid guessing at a root cause:

- Confirmed `window.isSecureContext === false` and
  `navigator.clipboard === undefined` under these conditions, as
  expected.
- Confirmed the existing `execCommand("copy")` fallback path *did* fire
  correctly and returned `true` for both a triple-click selection and a
  realistic mouse-drag selection — i.e. the prior fix's mechanics were
  not broken. The user-visible problem was the total absence of
  success/failure feedback, not a logic bug in the copy path itself.

### Task report

| Journey | Summary | Validation command | Result |
|---|---|---|---|
| 26 | New `copyResultMessage(success)` in `public/terminal-clipboard.js` (pure, DOM-free, same pattern as `isCopyShortcut`) | `node --experimental-strip-types --test public/terminal-clipboard.test.js` | RED (export missing) → GREEN (7 pass) |
| 26 | `public/app.js`: `copyToClipboard`/`copyToClipboardFallback` now report success/failure via a small toast (`#copy-toast`, bottom-right of the terminal, auto-dismisses after 1.8s on success) | manual browser verification (below) | PASS |
| 27 | On total failure (both `navigator.clipboard.writeText` and `execCommand("copy")` fail), a fallback bar (`#copy-fallback`) appears above the terminal with a focused, pre-selected, readonly text input containing the selection, plus a close button; `detachTerminal()` clears both on session switch | manual browser verification (below) | PASS |
| — | Full backend + frontend suite unaffected | `npm test` | GREEN (250 pass, 0 fail) |
| — | Typecheck unaffected (change is `public/*.js`/`.html` only, outside `tsc`'s scope) | `npm run typecheck` | PASS (clean) |

### Manual verification (real browser, real server, exact reported conditions)

Server started with `TMUX_WEB_BIND_HOST=10.8.0.2` (this host's real
WireGuard IP) and driven with a real headless Chromium via
`playwright-core`, since `chrome-devtools` MCP had no browser binary
available in this environment (see next line for the substitution
rationale — Playwright's Chromium is a real Chromium build, driven over
the same CDP protocol, so this is equivalent verification, not a mock).

1. **Normal path**: logged in, created a project/session, ran
   `echo VERIFY_TEXT_789`, drag-selected the output line, pressed
   Cmd+C. Result: toast reading exactly `"Copied"` appeared (no error
   styling), fallback bar stayed hidden. Screenshot captured.
2. **Forced-failure path**: same flow, but `document.execCommand` was
   monkey-patched to always return `false` (simulating a browser that
   blocks the legacy copy API outright, e.g. stricter Safari/enterprise
   policy). Result: toast read exactly
   `"Auto-copy failed — press Cmd+C in the box below"` with error
   styling; the fallback bar appeared above the terminal with the
   selected line's text pre-filled *and* pre-selected in a focused
   `<input>`; clicking the close button hid both the bar and the toast.
   Screenshot captured.

Both screenshots visually confirm the styling matches the existing dark
theme (same `--panel`/`--border`/`--accent`/`--danger` tokens as
`.env-bar`) and does not overlap or clip any existing terminal chrome.

### Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|--------------------|-----------|------|--------|
| 50 | `copyResultMessage(true)` returns a plain success confirmation | `public/terminal-clipboard.test.js:copyResultMessage confirms success...` | unit | PASS |
| 51 | `copyResultMessage(false)` returns a message that points at the manual fallback box | `public/terminal-clipboard.test.js:copyResultMessage points at the manual fallback...` | unit | PASS |
| — | Toast shows `"Copied"` with no error styling on a successful copy (Clipboard-API-unavailable path, `execCommand` succeeds) | manual (Playwright-driven Chromium against the real server) | e2e | PASS |
| — | Toast shows the failure message with error styling, and the fallback input is focused/pre-filled/pre-selected, when `execCommand` fails | manual (Playwright-driven Chromium against the real server, `execCommand` forced to fail) | e2e | PASS |
| — | Closing the fallback bar hides both the bar and the toast | manual (Playwright-driven Chromium against the real server) | e2e | PASS |

### Known, intentional gap

- The manual e2e verification above is not wired into the automated test
  suite — this project has no browser-based test runner configured
  (`npm test` only covers `node:test` unit/integration tests), and adding
  one was judged out of scope for this fix. If Playwright (or similar)
  ever gets added as a project dependency, promoting the scenarios above
  into real `@playwright/test` specs would remove the need to
  re-reproduce them by hand for the next terminal-clipboard change.
- Real-world clipboard behavior on the user's actual machine (specific
  Chrome version, OS-level clipboard manager) could not be verified from
  this environment — only the DOM-level mechanics (`execCommand` return
  value, event handling, UI state) were confirmed. The visible
  success/failure feedback added here is specifically what closes that
  remaining gap: the user (or a future debugging session) can now tell
  which case occurred just by looking at the screen, without needing
  DevTools.

## Feature addendum: force local text selection when tmux mouse mode is on

**Source plan**: no `*.plan.md` file — produced inline via `/ecc:plan` +
follow-up debugging after the toast/fallback-box feedback (previous
addendum above) surfaced the real signal: the user reported tmux's own
status message ("copied to tmux buffer, paste with prefix + ]") instead
of this app's toast, meaning the browser-level copy handler never ran at
all.

### Root cause

Read xterm.js's actual source
(`node_modules/@xterm/xterm/src/browser/services/SelectionService.ts`)
rather than assuming: when the foreground shell program enables mouse
reporting (`set -g mouse on` in `tmux.conf`), xterm.js's own
`SelectionService.disable()` is called (`Terminal.ts`), and every
click-drag is forwarded to the PTY instead of being handled as a local
browser selection. tmux then intercepts the drag itself, running its own
copy-mode and stashing the result in tmux's internal buffer (not the
browser/OS clipboard) — which is exactly the "copied to tmux buffer"
message the user saw. Because xterm.js never registered a local
selection, `activeTerm.hasSelection()` was always `false`, so this app's
Cmd+C handler correctly did nothing (by design) — there was nothing
browser-side to copy.

xterm.js has a built-in override for this (`shouldForceSelection` in the
same file), but it is **platform-dependent**:

```ts
public shouldForceSelection(event: MouseEvent): boolean {
  if (Browser.isMac) {
    return event.altKey && this._optionsService.rawOptions.macOptionClickForcesSelection;
  }
  return event.shiftKey;
}
```

On Windows/Linux, Shift+drag forces local selection with no config
needed. On macOS, it's **Option+drag** — and only if
`macOptionClickForcesSelection` is explicitly turned on
(`common/services/OptionsService.ts` defaults it to `false` upstream).
`public/app.js` never set this option, so on macOS specifically there was
**no key combination at all** that could force local selection while
tmux's mouse mode was active. (An earlier reply in this debugging session
incorrectly suggested Shift+drag on Mac before this was checked against
the actual xterm.js source — corrected once the source was read.)

### User journey

28. As a macOS user with `mouse` enabled in `tmux.conf`, I want a way to
    select terminal text locally in the browser (for this app's Cmd+C
    handling to pick up), matching the Option+drag convention native
    macOS terminal apps (iTerm2, Terminal.app) already use for the same
    situation.

### Task report

| Journey | Summary | Validation command | Result |
|---|---|---|---|
| 28 | `public/app.js`: `Terminal` constructor now sets `macOptionClickForcesSelection: true` | manual browser verification (below) | PASS |
| 28 | `README.md` and a `title` tooltip on `#terminal` document the Option(Mac)/Shift(other) override, so this isn't only discoverable by reading source | manual read-through | PASS |
| — | Full suite unaffected | `npm test` | GREEN (250 pass, 0 fail) |
| — | Typecheck unaffected | `npm run typecheck` | PASS (clean) |

### Manual verification (real browser, real tmux mouse mode, macOS platform simulated)

Server bound to this host's real WireGuard IP (as in the prior addendum),
driven by a real headless Chromium via `playwright-core`, with
`navigator.platform` overridden to `"MacIntel"` (via `addInitScript`, set
before any page script runs) so xterm.js's `Browser.isMac` check takes
the same branch a real Mac user would hit. Inside the attached session,
ran `tmux set -g mouse on` to reproduce the reported environment, then:

1. **Plain drag, no modifier**: selected a line of real command output
   with an ordinary mouse drag, then pressed Cmd+C. Result: the Cmd+C
   `keydown` event's `defaultPrevented` was `false` (confirmed via an
   injected `keydown` listener) and the copy toast never appeared —
   i.e. this app's handler correctly did nothing, matching the
   now-understood root cause (tmux owns the drag, not the browser).
2. **Option+drag** (the fix): same flow, but held `Alt`
   (Playwright's modifier name for the physical Option key on macOS)
   during the drag. Result: `defaultPrevented` was `true` on the
   resulting Cmd+C, and the `"Copied"` toast appeared — confirmed via
   screenshot that no tmux status-line copy message appeared in the pane
   (the event never reached tmux, since `SelectionService` calls
   `event.stopPropagation()` when force-selecting while disabled).

### Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|--------------------|-----------|------|--------|
| — | With tmux mouse mode on, an unmodified drag-select does not trigger this app's copy handler (`defaultPrevented` stays `false`, no toast) | manual (Playwright-driven Chromium, `navigator.platform` spoofed to macOS, real `tmux set -g mouse on`) | e2e | PASS |
| — | With tmux mouse mode on, Option+drag (macOS) forces local selection and this app's existing Cmd+C handling completes successfully (`"Copied"` toast) | manual (same setup) | e2e | PASS |

### Known, intentional gap

- Not covered by an automated test, same reasoning as the prior
  addendum (no browser test runner in this project). This scenario is
  also inherently harder to unit-test than the pure `terminal-clipboard.js`
  functions, since it depends on xterm.js's internal `SelectionService`
  and a real PTY running `tmux` with mouse mode on — an integration test
  for it would need a fuller browser-test harness than this project
  currently has.
- This fix does not change behavior when mouse mode is on and no
  modifier is held — that drag still goes to tmux, by design (mouse mode
  is usually enabled on purpose, e.g. for pane resize/click-to-switch/
  scroll-to-scrollback, and this app has no way to distinguish "user
  wants to select text" from "user wants a mouse-mode interaction" other
  than the modifier key convention every other terminal app already
  uses).

## Feature addendum: mouse-wheel scroll drives tmux copy-mode

**Source plan**: no `*.plan.md` file — produced inline via `/ecc:plan`
(conversational mode) after the user reported the terminal "doesn't support
scroll yet."

### Root cause

tmux redraws its pane via cursor positioning rather than emitting new lines,
so a browser terminal's own native scrollback (xterm.js's local
`.xterm-viewport`, `scrollback` option) is mostly useless for a tmux
session — it mostly replays repaint noise, not usable history. The real
scrollback lives inside tmux's own copy-mode, and until this addendum,
reaching it depended entirely on the user's own `tmux.conf` having `set -g
mouse on` (undocumented as a *requirement* — README merely described its
side effect on click-drag selection, from the previous addendum). This
addendum makes scroll a first-class, always-on feature the server drives
directly, independent of the user's `tmux.conf`.

### User journeys

29. As a user, I want to scroll up in the terminal with my mouse wheel to
    see previous output, without needing to edit my own `tmux.conf`.
30. As a user who scrolled up, I want typing to automatically bring me back
    to the live pane, like every other terminal+tmux setup.

### Task report

| Journey | Summary | Validation command | Result |
|---|---|---|---|
| 29 | `src/tmux.ts`: added `getPaneMode`, `scrollPane`, `cancelCopyMode` — drive tmux's copy-mode directly via the `tmux` CLI (`display-message`, `copy-mode`, `send-keys -X`), mirroring the existing `createSession`/`killSession` exec pattern | `npm test` (14 new unit tests) | PASS |
| 29 | `src/pty-bridge.ts`: `ClientMessage` gains a `scroll` variant; `attachPtyToSocket` dispatches it to `scrollPane`, serializing tmux CLI calls per connection (`scrollQueue`) so concurrent copy-mode/send-keys calls can't race each other | `npm test` | PASS |
| 29 | `public/app.js`: a capture-phase `wheel` listener on `#terminal` fully replaces xterm.js's own wheel handling (`stopPropagation`/`preventDefault`), normalizes `deltaY`/`deltaMode`, and sends coalesced `scroll` WS messages | `node --check public/app.js`; manual browser check below | PASS |
| 30 | `attachPtyToSocket` tracks an optimistic "possibly in copy-mode" flag; the next `input` message(s) call `cancelCopyMode` before forwarding keystrokes | `npm test` | PASS |
| — | Real tmux integration: a `scroll` message against a live tmux session flips `#{pane_in_mode}` and advances `#{scroll_position}`, and the scrolled-to history line range shows genuinely earlier content; a following per-keystroke `input` sequence flips `#{pane_in_mode}` back and reaches the shell in order | `npm test` (`real tmux integration: a scroll message drives tmux copy-mode...`) | PASS |
| — | Full suite unaffected | `npm test` | GREEN (288 pass, 0 fail) |
| — | Typecheck unaffected | `npm run typecheck` | PASS (clean) |

### Bugs found and fixed during verification (not just written once and assumed correct)

1. **`tmux capture-pane -p` does not reflect a client's copy-mode scroll
   offset.** The first draft of the real-tmux integration test asserted on
   a raw `capture-pane -p` diff before/after scrolling — it passed, but for
   the wrong reason (the fill loop was still running, so the pane content
   was trivially different regardless of scrolling). Confirmed empirically
   with a throwaway session: `capture-pane -p` is unchanged by copy-mode
   scrolling even while `#{pane_in_mode}` is `1` and `#{scroll_position}` is
   nonzero — only `#{scroll_position}` and `capture-pane`'s own `-S`/`-E`
   history-range flags reflect it. Rewrote the test to assert on those, and
   to wait for an explicit completion marker before taking any snapshot.
2. **Only the first keystroke after a scroll-up waited for `cancelCopyMode`
   to finish; later keystrokes in the same burst raced ahead of it.** Found
   by the manual, real-browser check below (typing `echo
   RESUMED_MANUAL_CHECK` after scrolling only delivered a single stray
   character to the shell — the rest were swallowed by copy-mode's own
   keytable because they were written to the pty before the pending cancel
   had actually taken effect). Fixed in `attachPtyToSocket` by gating *every*
   input message on the in-flight cancel promise (`cancelInFlight`), not
   just the one that triggered it, while still calling `cancelCopyMode`
   exactly once per resume. Locked in with a unit test using a
   deliberately slow `cancelCopyModeFn` and a rapid burst of per-character
   `input` messages, and by rewriting the real-tmux integration test's
   resume step to send one WS message per keystroke (matching how
   `public/app.js`'s `term.onData` actually fires) instead of one combined
   string, which had been hiding the bug.

### Manual verification (real browser, real tmux, real project/session flow)

Driven end-to-end via Playwright (`playwright-core`, headless Chromium)
against a throwaway local git remote (a bare repo + working clone, isolated
from this project's own repository — no network dependency, no risk to real
branches): started the real server, registered a project, created a session
through the real HTTP API (real `git worktree add` + real `tmux
new-session`), logged into the real UI, attached the real xterm.js
terminal, and typed 300 numbered lines into the real shell. Then:

1. Hovered the terminal and issued a real wheel-scroll via
   `page.mouse.wheel(0, -900)`. Confirmed via `tmux display-message`
   against the real session that `#{pane_in_mode}` flipped to `1` and
   `#{scroll_position}` advanced to a positive value, and that
   `capture-pane -S <-scroll_position> -E <-scroll_position+5>` showed
   genuinely earlier `LINE_N` content.
2. Typed `echo RESUMED_MANUAL_CHECK` and pressed Enter. First attempt (before
   the multi-keystroke fix above) failed — only one stray character reached
   the shell. After the fix, `#{pane_in_mode}` correctly flipped back to `0`
   and the full command reached the shell, matching the automated
   real-tmux test.

Screenshots captured after each step (`after-scroll-up.png`,
`after-resume.png`) as visual evidence, not committed to the repo (ad hoc
verification artifact, not project documentation).

### Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|---|---|---|---|
| 29 | `getPaneMode`/`scrollPane`/`cancelCopyMode` build the correct `tmux` CLI invocations for every branch (already-in-mode vs not, up vs down, no-op on scroll-down when live) | `src/tmux.test.ts` | unit | PASS |
| 29 | `parseClientMessage` accepts a well-formed `scroll` message and rejects invalid direction/lines | `src/pty-bridge.test.ts` | unit | PASS |
| 29 | `attachPtyToSocket` dispatches `scroll` messages to the injected `scrollPaneFn` with the session name | `src/pty-bridge.test.ts` | unit | PASS |
| 30 | `attachPtyToSocket` calls `cancelCopyModeFn` before writing input that follows a scroll-up, skips it when no scroll-up preceded the input, and gates *every* keystroke in a rapid burst on a slow cancel (not just the first) | `src/pty-bridge.test.ts` | unit | PASS |
| 29, 30 | End-to-end against a real `tmux` binary: scrolling up advances the real pane's copy-mode scroll offset and reveals genuinely earlier history; a following per-keystroke `input` sequence exits copy-mode and reaches the shell, in order | `src/pty-bridge.test.ts` (`real tmux integration: a scroll message drives tmux copy-mode...`, gated on `isTmuxAvailable()`) | integration | PASS |
| 29, 30 | End-to-end in a real browser against the real HTTP API, real worktree/session creation, and a real wheel-scroll gesture | manual (Playwright-driven Chromium, described above) | e2e | PASS |

### Known, intentional gaps

- No automated test drives the actual `wheel` DOM event through a real
  browser inside `npm test` (this project has no browser test runner wired
  into the suite, same reasoning as the previous two addenda). The client
  deltaY/deltaMode normalization and coalescing logic in `public/app.js` is
  exercised only by manual verification and `node --check` for syntax.
- Multiple browser tabs/clients attached to the same tmux session can each
  drive copy-mode independently and interfere with each other's scroll
  position. Acceptable for a single-user, self-hosted tool — the same class
  of limitation as re-attaching to an already-attached session elsewhere in
  this app.
- The `SCROLL_PIXELS_PER_LINE` heuristic (34px) is a cross-browser
  approximation, not derived from the terminal's actual rendered line
  height — scroll speed may feel slightly off on unusual font sizes.
- A test-harness-only timing quirk was found and worked around (not a
  product bug): rapid-fire `tmux capture-pane` polling from *outside* any
  tmux client, run immediately before attaching a new client, can leave
  tmux's client-resolution in a state where a subsequent `copy-mode`/
  `send-keys -X` from that new client silently no-ops. `src/pty-bridge.test.ts`
  works around it with a short settle delay after such polling, documented
  inline at the call site. Production code never polls a session's own pane
  via external `tmux` CLI calls immediately before attaching, so this does
  not affect real usage.

## Feature addendum: multiple per-service open links

**Source plan**: no `*.plan.md` file — produced inline via `/ecc:plan`
(requirements/risk/step breakdown grounded in the existing per-session
environment feature), implemented via `/ecc:tdd-workflow`. The user's
real-world motivation: a session's `docker-compose.yml` sometimes runs more
than one browser-facing service (e.g. the frontend *and* a database UI like
DBeaver's web client, `dbeaver/cloudbeaver`) on an ephemeral/random host
port each, and the environment bar could previously only ever show one
**Open ↗** link (`env.json`'s singular `openService`/`openPort`).

### User journey

31. As the server owner, I want an **Open ↗** link for every service I care
    about in a session's environment (not just one), each resolved to
    whatever ephemeral host port docker actually picked for it, so I can
    e.g. open the frontend and a database web UI side by side to validate
    data the frontend just wrote — without hardcoding ports anywhere.

### Task report

| Journey | Summary | Validation command | Result |
|---|---|---|---|
| 31 | `src/env-config.ts`: new `open` array in `env.json` (`{ label?, service, port }[]`), parsed into `EnvConfig.openLinks: OpenLinkConfig[]`, replacing the old singular `openService`/`openPort` fields on the type. The legacy singular fields are still *read* from `env.json` (backward compatible with existing repos) and synthesized into a one-entry `openLinks` array labeled `"Open"` when `open` is absent; `open` wins when both are present | `node --experimental-strip-types --test src/env-config.test.ts` | RED (10 fail) → GREEN (15 pass) |
| 31 | `src/session-env.ts`: `resolveOpenUrl` (singular) replaced by `resolveOpenLinks`, resolving every configured link's `docker compose port <service> <port>` independently and in parallel (`Promise.all`) — one service not having published its port yet (still starting) never blocks the others from appearing. `EnvStatus.openUrl?: string` replaced by `EnvStatus.openLinks?: { label, url }[]` | `node --experimental-strip-types --test src/session-env.test.ts` | RED (7 fail) → GREEN (26 pass) |
| 31 | `src/server.test.ts` fixtures updated (`openUrl` → `openLinks`) — `server.ts` itself needed no change, it only passes `EnvStatus` through as JSON | `npm run typecheck` | GREEN (clean) |
| 31 | `public/index.html`/`public/app.js`: the single `<a id="env-open-link">` replaced with a `<span id="env-open-links">` container, rebuilt from scratch each poll (same pattern as the existing `renderLogsServiceOptions`) into one `<a class="env-action">` per resolved link | `node --check public/app.js` | PASS (syntax clean; no unit test — same DOM-rendering rationale as `renderLogsServiceOptions`, which was never unit-tested either) |
| 31 | `README.md`'s "Per-session environments" section updated: `open[]` schema documented with a DBeaver example, legacy shorthand and precedence rule spelled out | manual read-through | PASS |
| — | Full suite unaffected otherwise | `npm test` | GREEN (398 pass, 0 fail) |
| — | Typecheck | `npm run typecheck` | PASS (clean) |

### Manual smoke test (real Docker daemon, not a fake `exec`)

Same rationale as the original per-session-environments manual smoke test
above: unit tests prove `resolveOpenLinks`'s control flow against a fake
`composePort`, not that a real Docker daemon's ephemeral-port assignment for
*two simultaneous services* actually behaves the way the fakes assume.
Rather than register a scratch project through the live HTTP API (this
build machine already has a real tmux-web-managed server running against
the default `~/.tmux-web` data directory, managing real projects — sharing
that registry for a throwaway test would risk racing its writes), this was
verified by calling `session-env.ts`'s real exported functions
(`startSessionEnv`/`getSessionEnvStatus`/`stopSessionEnv`) directly, wired
to the real `docker-compose.ts` implementations (not fakes), against a
scratch `.tmux-web-env/` folder outside any tracked repo:

1. Wrote a scratch `docker-compose.yml` with two services: `web`
   (`nginx:alpine`, container port 80) and `dbeaver`
   (`dbeaver/cloudbeaver:latest`, container port 8978) — both published as
   `"127.0.0.1::<port>"` (ephemeral host port, per this project's own
   documented convention), and a scratch `env.json` with
   `"open": [{"label":"Frontend","service":"web","port":80},
   {"label":"DBeaver","service":"dbeaver","port":8978}]`.
2. Called `startSessionEnv` for a fake `Project`/session slug pointing at
   that scratch worktree. Polled `getSessionEnvStatus` until `"running"`.
3. Result: both links resolved on the very first `"running"` poll, each to
   its own distinct ephemeral port docker actually picked —
   `openLinks: [{"label":"Frontend","url":"http://localhost:32796"},
   {"label":"DBeaver","url":"http://localhost:32795"}]` — confirming
   per-service port resolution is independent and correct, matching the
   user's literal DBeaver-web use case.
4. `fetch()`'d both resolved URLs directly (retrying every 1.5s up to 20
   times, since `cloudbeaver`'s HTTP server takes longer to become ready
   than nginx's even after docker reports the container "running"): both
   returned HTTP 200, confirming the resolved ports actually point at the
   right container in each case.
5. Called `stopSessionEnv`; a follow-up `getSessionEnvStatus` returned
   `{"phase":"idle"}` with no `openLinks`, confirming teardown.
6. Verified via `docker ps -a`/`docker volume ls` filtered on this scratch
   compose project's name that no containers or volumes were left behind,
   and that the host's other, unrelated running containers (including
   another project's own real `dbeaver/cloudbeaver` container, coincidentally
   already running on this build machine for unrelated work) were completely
   untouched throughout.

All steps passed. Driver script and scratch fixtures were temporary
(written under the session's own scratchpad directory, not this repo) and
were deleted afterward.

### Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|--------------------|-----------|------|--------|
| 52 | `loadEnvConfig` parses `open[]` into `openLinks`, defaulting a missing `label` to the service name | `src/env-config.test.ts:loadEnvConfig parses the open[] array into openLinks, defaulting label to the service name` | unit | PASS |
| 53 | The legacy singular `openService`/`openPort` shape still works, synthesized into a one-entry `openLinks` array labeled `"Open"` | `src/env-config.test.ts:loadEnvConfig falls back to a single openLinks entry from legacy openService/openPort` | unit | PASS |
| 54 | A legacy `openService` with no matching `openPort` (or vice versa) resolves to an empty `openLinks`, not a half-built link | `src/env-config.test.ts:loadEnvConfig ignores a legacy openService with no matching openPort...` | unit | PASS |
| 55 | When both `open[]` and the legacy singular fields are present, `open[]` wins | `src/env-config.test.ts:loadEnvConfig prefers the open[] array over legacy openService/openPort...` | unit | PASS |
| 56 | Malformed `open[]` (not an array, or an entry missing `service`, with a non-integer `port`, or a non-string `label`) is rejected with `EnvConfigError` before `loadEnvConfig` ever returns | `src/env-config.test.ts` (×4) | unit | PASS |
| 57 | `getSessionEnvStatus` resolves every configured `openLinks` entry independently — a service that hasn't published its port yet is simply omitted, without blocking the others | `src/session-env.test.ts:getSessionEnvStatus resolves multiple openLinks independently, omitting entries whose service hasn't published a port yet` | unit | PASS |
| 58 | Once every configured service has published its port, all configured links resolve, each to its own host port | `src/session-env.test.ts:getSessionEnvStatus resolves every configured openLinks entry once all services have published their ports` | unit | PASS |
| 59 | A config with no `openLinks` at all reports no `openLinks` on the status (not an empty-but-present array) | `src/session-env.test.ts:getSessionEnvStatus reports no openLinks when the config declares none` | unit | PASS |
| 60 | End-to-end against a real Docker daemon: two distinct services' ephemeral host ports both resolve correctly and independently, and both are actually reachable over HTTP | manual smoke test (see above) | integration (real Docker) | PASS |

### Coverage

```
npm run test:coverage
```

```
env-config.ts   | 100.00 |    93.75 |  100.00 |
session-env.ts  | 100.00 |    98.28 |  100.00 |
all files       |  96.37 |    95.31 |   95.85 |
```

398 tests total, 0 failures. (This is the whole-suite figure at the time
this addendum was written — later addenda in this document may report a
different total; see each addendum's own "Task report" for the count at
that point in time.)

### Known, intentional gaps

- **Frontend caveat, same as every other UI change in this report**: no
  browser is installed in this build environment, so `renderOpenLinks`'s
  actual DOM output (multiple `<a class="env-action">` elements, correct
  `href`/label text, correct show/hide behavior across polls) was verified
  only via `node --check` (syntax) and a manual read-through against
  `index.html`'s element IDs — not driven through a real rendered page.
  Flagged explicitly rather than overclaiming, consistent with this
  project's established practice for `app.js`.
- The manual smoke test above calls `session-env.ts`'s exported functions
  directly with a fake `Project` object and a throwaway `SessionEnvStore`,
  rather than driving the full HTTP API against a live `main.ts` process —
  deliberately, to avoid touching the real `~/.tmux-web` project registry
  already in active use on this build machine for unrelated real projects.
  This still exercises the real `docker-compose.ts` (`composeUp`/
  `composePs`/`composePort`/`composeDown`) against a real Docker daemon,
  which is the actual integration risk this feature introduces; the HTTP
  routing layer itself is unchanged by this feature (still just passes
  `EnvStatus` through as JSON) and remains covered by `server.test.ts`.
