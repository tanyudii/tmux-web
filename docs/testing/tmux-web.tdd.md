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

The changes-sidebar **frontend** (`public/app.js`'s tree-building, accordion-diff-toggle, and 5s polling) is not unit-tested — same rationale as the rest of the frontend in this project (no browser test framework, no build step). Verified via: JS syntax check (`node --check`), a full DOM-id cross-reference against `index.html`, and the API/WS layers it calls being independently verified end-to-end (see task report). No GUI browser is installed on the deployment server this was built on, so the actual click/render behavior was not driven through a real browser session — flagged explicitly rather than overclaiming. The environment-bar frontend added in this feature (status badge, Setup/Stop/Open) carries the exact same caveat — see "Frontend caveat" above.

## Coverage

```
npm run test:coverage
```

```
all files            |  98.41 |    94.89 |   94.89 |
auth.ts              |  92.86 |    94.12 |  100.00 | (16-17 uncovered)
config.ts            | 100.00 |   100.00 |  100.00 |
docker-compose.ts    |  97.35 |    84.00 |   90.00 | (8-10 uncovered)
env-config.ts        | 100.00 |    85.19 |  100.00 |
git-status.ts         |  97.60 |    95.92 |  100.00 | (152-155 uncovered)
project-sessions.ts  |  98.52 |    86.96 |   87.50 | (40-41 uncovered)
projects.ts          |  97.67 |    90.00 |  100.00 | (33-34 uncovered)
pty-bridge.ts        |  91.49 |    92.00 |   85.71 | (45-52 uncovered)
run-script.ts        |  83.33 |    83.33 |   50.00 | (12-18 uncovered)
server.ts            |  96.82 |    90.23 |  100.00 | (196-197, 240-241, 265-266, 291-292, 300-301 uncovered)
session-env.ts       | 100.00 |    93.33 |  100.00 |
session-naming.ts    | 100.00 |   100.00 |  100.00 |
slug.ts              | 100.00 |   100.00 |  100.00 |
tmux.ts              | 100.00 |   100.00 |  100.00 |
worktree.ts          |  94.59 |    78.26 |   88.89 | (19-20, 84-85, 109-110 uncovered)
```

222 tests total, 0 failures, 0 skipped (the real-tmux and real-git
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
- **`server.ts` lines 291-292 / 300-301**: the env routes' `throw error`
  fallback for an error `sendMappedError` doesn't recognize (surfacing as
  a generic 500). Same "unmapped error falls through to 500" shape already
  left uncovered for the changes/diff routes (lines 240-241/265-266,
  themselves unchanged from before this feature) — this project already
  has one dedicated test proving that shape works (`propagates unexpected
  (non-validation) errors as 500` on the original session routes); adding
  five more copies for every subsequent route was judged low marginal
  value.
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
