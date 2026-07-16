# TDD Evidence: view live docker-compose service logs in a popup (KMP web client)

## Source

No separate `*.plan.md` file — the plan was presented and confirmed inline in the
conversation that preceded this delegation (parent task description enumerating Tasks
2 through 12). The server side (`/ws/logs` endpoint, `src/docker-compose.ts`,
`src/log-stream.ts`, `src/service-name.ts`) was already fully built with its own
passing tests before this work started; this task is 100% inside `kmp/`. Task 1
(`LogsSocket`/`LogsEvent` interface) was already done before this delegation began.

## User journeys

1. A user has a session with a `.tmux-web-env/docker-compose.yml` environment running.
   They click a service row's new logs icon in the environment dropdown -> a popup
   opens and streams that service's live stdout/stderr.
2. While the popup is open, the user clicks the header's service switcher and picks a
   different service -> the popup stays open, the buffer resets, and the new
   service's logs start streaming immediately (no reconnect-to-old-service flicker).
3. The user closes the popup (X button) -> the underlying terminal regains focus and
   keyboard/click interactivity immediately (the exact regression class flagged by
   this repo's `CLAUDE.md` from the `RenameWindowDialog` incident: a Popup/Dialog
   rendered over Compose Web's native DOM terminal view can leave the terminal
   unresponsive if the visibility gating is wrong).

## Task report

| Task | What it covers | Validation command | Result |
|---|---|---|---|
| 2/3 | `FakeLogsSocket` + `LogsViewModel` (TDD core cycle) | `./gradlew :composeApp:jvmTest --tests "*LogsViewModelTest*"` | RED then GREEN, see below |
| 4 | `EnvironmentViewModel.logsService` state (TDD) | `./gradlew :composeApp:jvmTest --tests "*EnvironmentViewModelTest*"` | RED then GREEN, see below |
| 5 | `KtorLogsSocket` + DI wiring (no dedicated test, matches `KtorTerminalSocket` convention) | `./gradlew :composeApp:compileKotlinJvm` | Compiles clean |
| 6 | `TmuxIcons.Logs` glyph | `./gradlew :composeApp:compileKotlinJvm` | Compiles clean |
| 7 | `TmuxLogsDialog` composable (no dedicated test, `ui` package excluded from Kover) | `./gradlew :composeApp:compileKotlinJvm` | Compiles clean |
| 8 | `ServiceRow`/`TmuxEnvironmentMenu` wiring | `./gradlew :composeApp:compileKotlinJvm` + `detekt` | Compiles clean; one `LongMethod` finding fixed (see Task 10) |
| 9 | `TerminalScreen.kt` + `WebMainPane.kt`/`WebShellScreen.kt` wiring | `./gradlew :composeApp:compileKotlinJvm` | Compiles clean |
| 10 | Full gate: detekt + jvmTest + koverVerify | `./gradlew detekt :composeApp:jvmTest koverHtmlReport koverVerify` | All green, see below |
| 11 | Live browser verification | headless Chromium + `playwright-core`, real `docker compose` fixture | PASSED — see below |
| 12 | This report | — | — |

### Task 2/3 — RED

```
> Task :composeApp:compileTestKotlinJvm FAILED
e: .../presentation/LogsViewModelTest.kt:21:9 Unresolved reference 'LogsViewModel'.
```
Compile-time RED for the right reason — `LogsViewModel` did not exist yet. Commit:
`test: add reproducer for LogsViewModel logs streaming state` (`385d73e`).

### Task 2/3 — GREEN

```
> Task :composeApp:jvmTest
BUILD SUCCESSFUL in 6s
```
All 7 `LogsViewModelTest` cases pass (verified via
`composeApp/build/test-results/jvmTest/TEST-com.tanyudii.tmuxweb.presentation.LogsViewModelTest.xml`,
`tests="7" failures="0" errors="0"`). Commit:
`fix: implement LogsViewModel logs streaming state` (`1cd20b8`). No refactor commit
needed — the minimal implementation was already small and clean.

### Task 4 — RED

```
> Task :composeApp:compileTestKotlinJvm FAILED
e: .../EnvironmentViewModelTest.kt:147:28 Too many arguments for 'fun showLogs(): Unit'.
e: .../EnvironmentViewModelTest.kt:148:51 Unresolved reference 'logsService'.
e: .../EnvironmentViewModelTest.kt:150:19 Unresolved reference 'switchLogsService'.
```
Confirmed no other call site referenced the old `isShowingLogs`/no-arg `showLogs()`
API (`grep -rn "isShowingLogs\|showLogs\|hideLogs" kmp/` before implementing). Commit:
`test: change showLogs/hideLogs test to the logsService API` (`01b00e6`).

### Task 4 — GREEN

```
> Task :composeApp:jvmTest
BUILD SUCCESSFUL in 5s
```
All 9 `EnvironmentViewModelTest` cases pass (`tests="9" failures="0" errors="0"`).
Commit: `fix: track logsService instead of an isShowingLogs boolean` (`4663be0`).

### Task 10 — full gate (first pass found 2 detekt findings, fixed)

```
/.../TmuxEnvironmentMenu.kt:185:13: The function EnvironmentDropdownContent is too
  long (64). The maximum length is 60. [LongMethod]
/.../TmuxLogsDialog.kt:49:1: Line detected, which is longer than the defined maximum
  line length in the code style. [MaxLineLength]
```
Fixed by extracting `ServerRunningHeader()` out of `EnvironmentDropdownContent` and
wrapping the long kdoc comment onto multiple lines. Re-run:

```
> Task :composeApp:detekt
BUILD SUCCESSFUL in 1s
```

`KtorLogsSocket` was also added to the Kover exclusion list in
`composeApp/build.gradle.kts` (matching `KtorTerminalSocket`'s existing exclusion —
Ktor's client `MockEngine` has no WebSocket support to test against). Final gate:

```
> Task :composeApp:detekt        BUILD SUCCESSFUL
> Task :composeApp:jvmTest       BUILD SUCCESSFUL
> Task :composeApp:koverHtmlReport
Kover: HTML report for ':composeApp' file://.../composeApp/build/reports/kover/html/index.html
> Task :composeApp:koverVerify   BUILD SUCCESSFUL
```

Coverage (all classes, from the HTML report):

| Metric | Result |
|---|---|
| Class | 88.3% (174/197) |
| Method | 87.2% (327/375) |
| Branch | 58.8% (360/612) |
| Line | 89.1% (971/1090) |
| Instruction | 83.1% (10064/12109) |

Gate (`minBound(80)`) passes comfortably. `com.tanyudii.tmuxweb.data.remote.logs`
package coverage is low in isolation (only `LogsSocket`/`LogsEvent` count toward it —
`KtorLogsSocket` is excluded) since those are pure interface/sealed-class declarations
exercised indirectly through `FakeLogsSocket` in tests, not directly.

### Task 11 — live browser verification

**This was actually run, not skipped.** Setup:

- Built the production bundle: `./gradlew :composeApp:wasmJsBrowserDistribution` —
  `BUILD SUCCESSFUL in 55s`.
- Isolated dev instance: separate `HOME` override (`$SCRATCH/logs-verify-home`), a
  hand-written `config.json` (token/port 15311/host), started via
  `HOME=$SCRATCH/logs-verify-home node --experimental-strip-types src/main.ts start`
  from this worktree (serves the wasmJs bundle it just built, same pattern as the
  prior `session-switch-terminal-stuck.tdd.md` session).
- Driven with `playwright-core` (installed standalone into the scratchpad, not this
  repo's `package.json`) against the cached Chromium binary
  `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`, headless.
- **Compose Web renders to a canvas with no accessible DOM** (confirmed:
  `page.content()` returns an essentially empty `<body>`, and `page.accessibility` is
  undefined on this Playwright-core build) — all interaction had to be pixel
  coordinate clicks + keyboard events against screenshots, not DOM locators. This
  matches this repo's established verification method for Compose Web (see
  `session-switch-terminal-stuck.tdd.md`).
- Real fixture: a throwaway git repo (`origin` remote pointing at itself, so
  `tmux-web`'s "resolve default branch from origin" step succeeds), registered as
  project `logs-fixture` through the actual "New project" UI dialog (including the
  real directory-picker flow), session `work` created through the real "New session"
  UI dialog (real `git worktree add` + real tmux session on the host). A
  `.tmux-web-env/docker-compose.yml` with 3 `busybox` services (`web`, `worker`,
  `scheduler`), each emitting one distinctly-timestamped log line per second, was
  dropped into that real worktree path.

Steps actually driven, in order:

1. Connected to the isolated server (Server URL + Access token fields, both
   pixel-coordinate-filled since there's no DOM to target) — screenshot
   `service-logs-*` not needed for this step, confirmed via the resulting sidebar.
2. Created project `logs-fixture` pointed at the fixture repo via the real folder
   picker (navigated up a directory, into the repo folder, "Use this folder", "Create
   project").
3. Created session `work` via the real "New session" dialog — this is a genuine
   `git worktree add` + tmux session on the host (confirmed by the terminal
   showing the real worktree path prompt).
4. Clicked the environment icon (collapsed toggle, "Setting up..." then "3/3") to run
   `docker compose up` for the fixture's 3 services — confirmed via `docker ps`
   showing `logs-fixture-b1b512__work-{web,worker,scheduler}-1`, all `Up`.
   Screenshot: `service-logs-01-env-3of3-running.png`.
5. Opened the environment dropdown — confirmed the new logs icon button appears on
   every `ServiceRow`, before the existing state text/external-link icon, exactly per
   Task 8's design. Screenshot: `service-logs-02-service-rows-with-logs-icon.png`.
6. Clicked the "web" row's logs icon — the `TmuxLogsDialog` popup opened, header
   showing "Logs: web" + a pulsing green "live" badge, body streaming real
   `docker compose logs`-style output (`web-1 | web log line <timestamp>`, one new
   line per second, auto-scrolling to the bottom). Screenshot:
   `service-logs-03-popup-streaming-web-logs.png`.
7. Clicked the "Logs: web ▾" header to open the service switcher dropdown — listed
   `scheduler`/`web`/`worker` with status dots, matching `TmuxEnvironmentMenu`'s own
   dropdown styling. Screenshot: `service-logs-04-service-switcher-dropdown.png`
   (also shows the manual "jump to latest" chevron appearing since the list had
   scrolled during the dropdown interaction — confirms the not-at-bottom heuristic
   fires).
8. Clicked "worker" — the popup did **not** close; header switched to "Logs: worker",
   the buffer was visibly reset (no leftover `web-1` lines mixed in), and fresh
   `worker-1 | worker log line <timestamp>` output started streaming immediately.
   Screenshot: `service-logs-05-switched-to-worker-buffer-reset.png`.
9. Closed the popup via the X button — popup disappeared, terminal became visible
   again. Screenshot: `service-logs-06-popup-closed.png`.
10. Clicked into the terminal area and typed
    `echo TERMINAL_STILL_ALIVE_AFTER_LOGS_POPUP` + Enter — the command executed and
    echoed correctly, confirming the terminal regained focus/click-through
    interactivity after the popup closed (the exact `CLAUDE.md`-flagged regression
    class). Screenshot: `service-logs-07-terminal-regained-focus.png`.
11. Additionally exercised: mouse-wheel scroll inside the popup body and the
    "jump to latest" button. The manual-scroll-vs-auto-scroll heuristic showed some
    minor flakiness under this fixture's fast (1 line/sec) stream — the jump button
    sometimes appeared/disappeared across frames rather than staying stably visible
    while scrolled up. Core behavior (content still updates, no crash, no stuck
    scroll position) was unaffected. Per the task's own instructions this polish
    item was deliberately kept simple ("don't over-engineer"); this is a known minor
    cosmetic nuance, not a functional defect, and is called out explicitly in "Known
    gaps" below rather than silently glossed over.

Cleanup performed after verification: `docker compose ... down` (all 3 fixture
containers stopped/removed), isolated dev server process killed, port 15311 confirmed
freed. No changes were made to the real `~/.tmux-web` config/projects/worktrees used
by this very session's own tmux-web instance (port 5309, untouched throughout).

## Test specification

| # | Guarantee | Test file | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Initial `LogsUiState` has empty `lines` and `isConnected == false` | `LogsViewModelTest.kt` | unit | PASS | `TEST-...LogsViewModelTest.xml` |
| 2 | Connecting opens the socket with `(projectId, sessionName, service)` and appends `Output` chunks in arrival order (no line-splitting) | `LogsViewModelTest.kt` | unit | PASS | same |
| 3 | `LogsEvent.Opened` sets `isConnected = true` | `LogsViewModelTest.kt` | unit | PASS | same |
| 4 | `LogsEvent.Closed(cause)` clears `isConnected`, sets `errorMessage`, keeps accumulated output | `LogsViewModelTest.kt` | unit | PASS | same |
| 5 | `LogsEvent.Closed(null)` leaves `errorMessage` null | `LogsViewModelTest.kt` | unit | PASS | same |
| 6 | `switchService` closes the current socket, reconnects with a new `connect` call for the new service, resets the buffer | `LogsViewModelTest.kt` | unit | PASS | same |
| 7 | `close()` disposes the underlying socket | `LogsViewModelTest.kt` | unit | PASS | same |
| 8 | `showLogs(service)` sets `logsService`; `switchLogsService(service)` changes it; `hideLogs()` clears it | `EnvironmentViewModelTest.kt` | unit | PASS | `TEST-...EnvironmentViewModelTest.xml` |
| 9 | All 8 pre-existing `EnvironmentViewModelTest` cases still pass after the `logsService` change | `EnvironmentViewModelTest.kt` | unit | PASS | same |
| 10 | Popup opens and streams a real service's live logs when a service row's logs icon is clicked | live E2E (Playwright + real docker-compose) | manual/live | PASS | `service-logs-03-*.png` |
| 11 | Switching service via the header dropdown keeps the popup open and resets the buffer to the new service's stream | live E2E | manual/live | PASS | `service-logs-04-*.png`, `service-logs-05-*.png` |
| 12 | Closing the popup restores the terminal's focus/click-through interactivity | live E2E | manual/live | PASS | `service-logs-06-*.png`, `service-logs-07-*.png` |

## Coverage result (Task 10)

See table above — Class 88.3%, Method 87.2%, Branch 58.8%, Line 89.1%, Instruction
83.1%, gate `minBound(80)` passes. `KtorLogsSocket` excluded from the gate (matches
`KtorTerminalSocket`'s existing exclusion).

## Known gaps

- `KtorLogsSocket`, `TmuxLogsDialog`, and the screen-wiring changes
  (`TerminalScreen.kt`, `WebMainPane.kt`, `WebShellScreen.kt`,
  `TmuxEnvironmentMenu.kt`'s `ServiceRow`) have **no dedicated automated test**. This
  matches this repo's existing, documented convention: `com.tanyudii.tmuxweb.ui` is
  excluded from the Kover gate ("automated UI-tree tests have limited value on these
  targets... a deliberate scope call, not a gap" per `composeApp/build.gradle.kts`),
  and `KtorTerminalSocket` (the exact pattern `KtorLogsSocket` mirrors) has never had
  a dedicated unit test either, for the same reason (Ktor's client `MockEngine` has
  no WebSocket support, `ktorio/ktor#1413`). These are instead covered by Task 11's
  live browser verification above.
- The "jump to latest" auto-scroll heuristic in `TmuxLogsDialog` showed minor
  flakiness (button visibility toggling across frames) under a fast, continuous
  1-line/sec log stream during manual live verification. This is a cosmetic nuance
  of the deliberately-simple heuristic the task instructions asked for ("don't
  over-engineer"), not a functional break — content keeps streaming and auto-scroll
  to latest still works. Flagged here rather than silently ignored; a future pass
  could debounce the near-bottom check if this becomes user-visible in practice.
- No `wasmJsTest` coverage exists in this repo at all (confirmed pattern from prior
  TDD reports) — `jvmTest` (the `jvm()` target added purely so Kover has JVM
  bytecode to instrument) is the only automated layer, consistent with every other
  ViewModel in this codebase.
