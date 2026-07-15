# TDD Evidence: KMP Web terminal stuck on previous project after switching sessions

## Source

No `*.plan.md` file — inline `/plan` conversation, then `/tdd-workflow` to apply it.
Bug report (user, 2026-07-15): "ketika saya open session dari project X, dan saya buka
session di project Z, session window saya nyangkut di project X dan tidak berubah ke
project Z" (terminal panel stays stuck on project X's shell after switching to a
session in project Z).

## User journey

As a user with an active terminal session in Project X, I want the terminal panel to
switch immediately to Project Z's shell when I select a session in Project Z, so that
I see the right project's terminal and my keystrokes go to the right session.

## Why this bug needed a live-browser test, not a unit test

The two files this fix touches are **both deliberately excluded from Kover coverage**
in `kmp/composeApp/build.gradle.kts`:

- `packages("com.tanyudii.tmuxweb.ui")` — "automated UI-tree tests have limited value
  on these targets... a deliberate scope call, not a gap" (manual QA instead).
- `packages("com.tanyudii.tmuxweb.terminal")` — "Platform expect/actual glue verified
  by manual on-device QA... they have no real behavior of their own to verify" (JS
  interop with xterm.js).

This matches `CLAUDE.md`'s explicit, standing instruction for this repo: "Compile +
detekt + unit tests passing is not sufficient evidence that a Compose Multiplatform
Web UI change works," listing this exact class of bug (Compose recomposition/xterm.js
interop) as historically invisible to the Kotlin/Gradle toolchain. There is also no
`wasmJsTest` source set in this repo (confirmed: no such directory exists), consistent
with that policy. Per the TDD workflow's own plan-safety guidance, this is recorded
here as the reason automated RED/GREEN tests were not added, in favor of a live
browser RED → fix → GREEN cycle, which is this project's actual established
verification method for this exact class of change.

## Root cause

`PlatformTerminalView.wasmJs.kt`'s `terminal` (the xterm.js instance) was held in
`remember { mutableStateOf<XtermTerminal?>(null) }` with **no key**, and the call site
in `WebMainPane.kt` did not wrap it in `key(session.fullName) { ... }`. Compose's
`WebShellViewModel.selectSession()` updates `selectedProjectId` and
`selectedSessionName` atomically (no intermediate null), so switching directly from
one active session to another never unmounted the terminal composable — the same
xterm.js instance (and its stale `onData`/`handleReady` closures, bound to the
previous session's now-disconnected socket) kept being reused. The new session's
`TerminalViewModel.connect()` was consequently never even called.

(A separate reproduction path that goes through "click a project header first" clears
`selectedSessionName` to `null` in between, which unmounts `PlatformTerminalView`
entirely and incidentally hides the bug — this is why the fix had to be verified via
the *direct* session-to-session switch specifically, not project-to-project.)

## Task report

### RED — bug reproduced live in a real browser

- **Setup**: isolated dev instance (`HOME` override → separate `~/.tmux-web` config
  dir + port `15309`, per `src/main.ts`'s own documented "throwaway dev/preview
  instance" pattern), two throwaway git repos as Project X / Project Z, real tmux
  sessions `work-x` / `work-z`, driven with `playwright-core` against the cached
  Chromium binary (`~/.cache/ms-playwright/chromium-1228`), against the
  **pre-fix** `wasmJsBrowserDistribution` build.
- **Steps driven**: open `work-x`, type `echo MARKER_X_ROUND2` → directly select
  `work-z` (session-to-session, no project-header click in between) → observe.
- **Result**: terminal kept showing Project X's shell (prompt path
  `.../project-x-b56026/work-x$`, echoing `MARKER_X_ROUND2`) even though the top bar
  and sidebar had already switched to "Project Z / work-z". Typing
  `echo MARKER_Z_ROUND2` afterwards produced no visible output at all (input silently
  went to X's already-disconnected socket).
- **Evidence**: `.claude/tdd/evidence/01-RED-terminal-stuck-on-project-x.png`,
  `02-RED-typed-input-lost.png`.

### GREEN — fix applied and verified live

- **Fix** (`kmp/composeApp/src/commonMain/.../ui/web/WebMainPane.kt` +
  `kmp/composeApp/src/wasmJsMain/.../terminal/PlatformTerminalView.wasmJs.kt`):
  1. Wrapped the `PlatformTerminalView(...)` call in `key(session.fullName) { ... }`
     so Compose creates a fresh composable instance (and therefore a fresh xterm.js
     instance + freshly-bound `handleReady`/`onData` closures) whenever the session
     changes, even across a direct session-to-session switch.
  2. Added `DisposableEffect(Unit) { onDispose { terminal?.dispose() } }` in
     `PlatformTerminalView.wasmJs.kt` so the old xterm.js instance and its listeners
     are actually released when a session's composable instance is torn down,
     instead of leaking one xterm.js object per session switch.
- **Validation**: rebuilt `./gradlew :composeApp:wasmJsBrowserDistribution` (BUILD
  SUCCESSFUL), re-ran the exact same Playwright scenario against the same running
  dev instance (no server restart needed — static assets are re-read from disk).
- **Result**: terminal now shows Project Z's own shell immediately after the direct
  switch; typing lands correctly in Z's live session; switching back to X directly
  (again no intermediate project click) shows X's session still alive and correctly
  separated from Z's content — bidirectional switching confirmed.
- **Evidence**: `.claude/tdd/evidence/03-GREEN-terminal-switches-to-project-z.png`,
  `04-GREEN-typed-input-lands-in-z.png`, `05-GREEN-switch-back-to-x-still-alive.png`.

### Regression check — Popup/Dialog-over-terminal (CLAUDE.md's flagged incident class)

`CLAUDE.md` calls out a prior incident where a dialog rendered but was unclickable
because the terminal's real DOM overlay swallowed clicks meant for a Compose Popup.
Since this fix changes when the terminal composable (and its `HtmlElementView`) is
torn down/recreated, this was explicitly re-checked: opened the window-rename dialog
(`RenameWindowDialog`, the exact dialog named in that incident) while a session was
actively connected, typed a new name, clicked Cancel, and confirmed the terminal was
still responsive and correctly received a follow-up keystroke afterwards. No
regression — the dialog was clickable and dismissable, and the terminal kept working.

- **Evidence**: `.claude/tdd/evidence/06-regression-rename-dialog-not-swallowed.png`.

### Static analysis / build (partial — see caveat)

- `PlatformTerminalView.wasmJs.kt`: clean detekt run after this change (no
  `LongMethod`/`MaxLineLength` findings).
- `WebMainPane.kt`: this file is concurrently being modified by other in-progress
  work in this same worktree (a larger `ChangesRail`/mobile-screens refactor,
  unrelated to this fix — confirmed via `git diff`, which shows ~800 lines changed
  across 11 files, only 2 of which are this fix's target files). At the time of this
  check, that concurrent work had the file in a transiently broken state (a duplicate
  `ChangesRail` function declaration causing a genuine `compileKotlinJvm` failure) and
  several pre-existing/concurrent-only detekt findings (`LongMethod`,
  `TooManyFunctions`, `MaxLineLength` on lines this fix did not touch). This fix's own
  lines (the `key(session.fullName)` block) were re-verified clean and minimal after
  trimming; a full `./gradlew build`/`detekt`/`jvmTest` run across the whole module
  could not be completed cleanly **for reasons unrelated to this fix** while that
  concurrent work is still in flight. This should be re-run once that other work
  settles, before merging.

## Test specification

| # | What is guaranteed | Verification | Type | Result | Evidence |
|---|--------------------|--------------|------|--------|----------|
| 1 | Switching directly between two active sessions (different projects) updates the terminal panel to the newly-selected session's real content | Live Playwright + headless Chromium against a real `tmuxweb` dev instance, pre-fix | manual/live E2E | RED (confirmed broken) | `evidence/01-RED-*.png`, `02-RED-*.png` |
| 2 | Same scenario after the fix | Same script, rebuilt wasmJs bundle | manual/live E2E | GREEN | `evidence/03-GREEN-*.png`, `04-GREEN-*.png` |
| 3 | Switching back to the original session (also direct, no intermediate project click) still works and shows the correct, separated content | Same script, extended | manual/live E2E | GREEN | `evidence/05-GREEN-*.png` |
| 4 | Opening a Popup/Dialog while a session is connected still receives clicks and doesn't get swallowed by the terminal's DOM overlay | Live Playwright, hover + click through `RenameWindowDialog`, post-dialog terminal keystroke | manual/live E2E | GREEN (no regression) | `evidence/06-regression-*.png` |
| 5 | `PlatformTerminalView.wasmJs.kt` has no new static-analysis findings from this change | `./gradlew detekt` | static analysis | PASS | `gradle-detekt2.log` (session-local, not committed) |

## Coverage and known gaps

- No Kover coverage number applies: both changed files are in packages explicitly
  excluded from the coverage gate by project policy (see "Why this bug needed a
  live-browser test" above) — this is consistent with the project's existing,
  documented testing strategy, not a new gap introduced by this change.
- Full-module `./gradlew build` / `detekt` / `jvmTest` could not be completed cleanly
  at the time of this fix due to unrelated, concurrently in-progress edits to
  `WebMainPane.kt` (see "Static analysis / build" above). Re-run before merging.
- The Playwright driver scripts used for this verification are ephemeral (written to
  the session scratchpad, not committed) per this repo's existing convention of doing
  this kind of manual/live QA ad hoc each session rather than maintaining a permanent
  E2E suite (see `CLAUDE.md`'s "run" skill reference).
