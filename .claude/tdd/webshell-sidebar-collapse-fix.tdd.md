# TDD Evidence: WebSidebar project-row collapse fix

**Source plan**: no `*.plan.md` file — produced inline via `/ecc:plan` from a
free-form bug report ("after opening the project/session dropdown it can't
be collapsed").

## User journey

As a tmux-web user, I want to click a project row in the web sidebar to
expand it (revealing its sessions) and click the same row again to collapse
it, so I can manage sidebar clutter — previously, once a project was
selected, clicking its row again silently re-expanded it instead of
collapsing.

## Root cause

`WebSidebar.kt`'s `ProjectNode` row `onClick` called `onToggleProject(id)`
then `onSelectProject(id)` unconditionally on every click.
`WebShellViewModel.selectProject()` force-re-expands the project whenever
it isn't in `expandedProjectIds` — exactly the state right after the toggle
had just collapsed it, so the second call always undid the first.

## Task report

| Task | Summary | Validation command | Result |
|---|---|---|---|
| 1 | Regression reproducer mirroring the real `WebSidebar` click sequence | `./gradlew :composeApp:jvmTest --tests "...WebShellViewModelTest"` | RED (`AssertionError` at the collapse assertion) → see below |
| 2 | Centralized fix: new `WebShellViewModel.onProjectRowClick()` (already-selected → pure `toggleProject`; else → `selectProject`, unchanged auto-expand) + `WebSidebar.kt`/`WebShellScreen.kt` rewired to call it | same test file, updated to call `onProjectRowClick` directly | GREEN (24/24 in file, 316/316 module-wide) |
| 3 | Removed now-unused `onSelectProject` param from `ProjectNode` | `./gradlew detekt` | RED (`UnusedParameter`) → GREEN |
| 4 | Full module regression + wasmJs target compile | `./gradlew :composeApp:jvmTest :composeApp:detekt :composeApp:compileKotlinWasmJs` | PASS, all green |
| 5 | Live browser verification (mandatory per this repo's `CLAUDE.md` for Compose Web UI interactive-behavior changes) | real headless Chromium via `playwright-core`, isolated dev server instance | PASS — see below |

## RED evidence

```
WebShellViewModelTest[jvm] > clicking an expanded selected project row twice collapses it, mirroring WebSidebar's onClick[jvm] FAILED
    java.lang.AssertionError at WebShellViewModelTest.kt:84

23 tests completed, 1 failed
```

Genuine runtime RED: the test compiled and ran, and failed exactly at the
"now collapsed" assertion (the row re-expanded instead), matching the
reported bug — not an unrelated compile/setup failure. Checkpoint commit:
`7f141f0` ("test: add reproducer for WebSidebar project-row collapse bug").

## GREEN evidence

After centralizing the decision in `WebShellViewModel.onProjectRowClick()`
and rewriting the two tests to call that function directly (the function
the real UI now calls, removing any test/implementation drift risk since
this repo has no Compose UI test harness to exercise `WebSidebar.kt`'s
`onClick` lambda directly):

```
tests="24" skipped="0" failures="0" errors="0"
<testcase name="onProjectRowClick collapses an already-selected, expanded project[jvm]"
<testcase name="onProjectRowClick selects and expands an unselected project[jvm]"
```

Full module: `tests="316"`, 0 failures/errors across every `TEST-*.xml` in
`composeApp/build/test-results/jvmTest/`. `detekt` clean.
`compileKotlinWasmJs` — `BUILD SUCCESSFUL` (the actual shipping target for
this UI, not just the JVM target Kover uses for coverage). Checkpoint
commits: `bdcc3e9` (fix), `ac27687` (refactor cleanup).

## Live browser verification (real server, real headless Chromium)

**This was actually run, not skipped.** Setup:

- Built the production bundle: `./gradlew :composeApp:wasmJsBrowserDistribution`
  — `BUILD SUCCESSFUL`.
- Isolated dev instance: separate `HOME` override
  (`$SCRATCH/test-home`), hand-written `config.json` (token/port
  5310/host `127.0.0.1`), `TMUX_WEB_BROWSE_ROOT` pointed at this worktree
  so the real folder-picker dialog could reach a real git repo without
  traversing hidden dot-directories (the picker filters `.`-prefixed
  entries). Started via
  `HOME=... TMUX_WEB_PUBLIC_DIR=... TMUX_WEB_BROWSE_ROOT=... node --experimental-strip-types src/main.ts`
  from this worktree. Production (`127.0.0.1:5309`, the real systemd
  `tmux-web.service` on this host) was left untouched throughout and
  reconfirmed reachable after the isolated instance was torn down.
- Driven with `playwright-core` (already present from a prior session)
  against the cached Chromium binary
  `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`, headless.
- **Compose Web renders to a `<canvas>` with no accessible DOM** (confirmed
  pattern from this repo's own prior TDD sessions) — all interaction was
  pixel-coordinate mouse clicks against screenshots, not DOM locators.
- Real fixture: project `collapse-fixture` created through the actual "New
  project" UI dialog, including the real folder-picker flow, pointed at
  this worktree's own repo path (a real git repo).

Steps actually driven, in order (screenshots in
`/tmp/claude-1000/.../scratchpad/`, filenames below):

1. Connected to the isolated server (`00-initial.png`,
   `01-after-connect.png`).
2. Created project `collapse-fixture` via the real dialog + folder picker
   (`02`–`06-project-created.png`) — lands expanded but **not selected**
   (`createProject()` only expands, doesn't select; confirmed this is
   pre-existing, unrelated behavior, not part of the fix).
3. **Click 1** (project not yet selected): `onProjectRowClick` takes the
   `selectProject` branch — selects it, no visible expand-state change
   since it was already expanded. `07-after-click-1-should-collapse.png`
   confirms still expanded (expected, given point 2 above — see "Known
   gap" below on this step's misleading filename).
4. **Click 2** (now selected + expanded — the exact bug scenario):
   `onProjectRowClick` takes the `toggleProject` branch — **collapses
   correctly**. `08-after-click-2-should-expand.png` shows the chevron
   pointing right and the "New session" row gone. **This is the bug fix
   confirmed live.**
5. **Click 3**: expands again — `09-after-click-3-should-collapse.png`
   shows chevron down, "New session" visible again. Toggle direction
   flips correctly, not just once.
6. **Click 4**: collapses again — `10-collapsed-before-palette-test.png`.
   Toggle is stable across repeated clicks in both directions.
7. Command-palette regression check (exercises `selectProject()` directly,
   the code path left unchanged by this fix): `Ctrl+K`
   (`11-palette-open.png`), typed "collapse-fixture"
   (`12-palette-search-results.png`), `Enter` — sidebar shows the project
   selected **and** auto-expanded (`13-palette-selected-should-expand.png`).
   No regression in the palette's select-and-reveal behavior.

Cleanup performed after verification: isolated dev server process killed,
port 5310 confirmed freed, port 5309 (real production service) confirmed
still serving normally throughout and after.

## Test specification

| # | What is guaranteed | Test file / command | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | `onProjectRowClick` on an unselected project selects it and expands it | `WebShellViewModelTest.kt:onProjectRowClick selects and expands an unselected project` | unit | PASS | `TEST-...WebShellViewModelTest.xml` |
| 2 | `onProjectRowClick` on an already-selected, expanded project collapses it (not re-expand) | `WebShellViewModelTest.kt:onProjectRowClick collapses an already-selected, expanded project` | unit | PASS | same |
| 3 | Pre-existing `toggleProject`/`selectSession`/`createProject` behaviors unaffected | full `WebShellViewModelTest.kt` suite | unit | PASS | same, 24/24 |
| 4 | Whole module unaffected | `jvmTest` | unit | PASS | 316/316 |
| 5 | Static analysis clean, including the newly-unused param removal | `detekt` | lint | PASS | — |
| 6 | Shipping target (`wasmJs`) still compiles | `compileKotlinWasmJs` | compile | PASS | — |
| 7 | Clicking an already-selected, expanded sidebar project row collapses it in a real browser | live E2E (Playwright + real Chromium, real server) | manual/live | PASS | `08-after-click-2-should-expand.png` |
| 8 | Toggle continues to work bidirectionally across repeated clicks | live E2E | manual/live | PASS | `09-*.png`, `10-*.png` |
| 9 | Command-palette project selection still auto-expands (unchanged `selectProject` path) | live E2E | manual/live | PASS | `13-palette-selected-should-expand.png` |

## Known gaps

- **Behavior nuance, not covered by any test**: `onProjectRowClick`'s
  toggle-vs-select branch condition (`projectId == selectedProjectId`) is
  broader than `WebSidebar.kt`'s `projectActive` visual-highlight condition
  (`selectedProjectId == project.id && selectedSessionName == null`). If a
  session under project P is currently active (`selectedSessionName !=
  null`) and the user clicks P's row again, the new code takes the
  "already selected → pure toggle" branch and does **not** clear
  `selectedSessionName` / return to the project-overview pane — it just
  toggles the sidebar's expand state. Pre-fix, this incidentally happened
  as a side effect of the buggy unconditional `selectProject()` call.
  Flagged during code review (this session); arguably more correct
  (collapsing a tree row shouldn't need to also change the main pane), but
  it's a real, user-visible behavior change with zero test coverage. Not
  fixed or tested in this session — left as a follow-up if it turns out to
  matter in practice.
- **Naming convention nit** (also flagged in code review, not blocking):
  `onProjectRowClick` is the only `on`-prefixed public method in
  `WebShellViewModel`; every sibling method uses an imperative verb
  (`toggleProject`, `selectProject`, `loadProjects`, etc.). Left as-is
  since it's cosmetic.
- No `wasmJsTest` coverage exists for this interaction (confirmed pattern
  from prior TDD reports in this repo) — `jvmTest` is the only automated
  layer; live Playwright verification is this repo's established
  substitute for Compose UI test coverage on `ui.*` code.
