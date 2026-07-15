# TDD Evidence: Changes rail redesign (full-height right sidebar + collapsible tree)

## Source

No `*.plan.md` file — inline `/plan` conversation (restated requirements, pattern
grounding against `WebSidebar.kt`'s `ProjectNode`/`SidebarRow` and the existing
untested `buildFileTree`/`FileTreeNode` in `domain/FileTreeNode.kt`), then
`/tdd-workflow` to implement it.

User request (2026-07-15, Bahasa Indonesia): remove the empty space above the
Changes rail caused by `WindowTabs` stretching full width above it even when
only a couple of tmux windows are open, reposition the rail as a right-side
panel, and turn the flat staged/unstaged/untracked file list into a
collapsible folder tree "seperti pada file explorer".

## User journeys

1. As a user with only 1–2 tmux windows open, I want the Changes rail to sit
   flush against the top of the pane with no empty strip above it, so the UI
   doesn't look broken/unfinished.
2. As a user with changes spread across nested folders, I want to collapse and
   expand folders in the Changes rail like a file explorer, so I can focus on
   one area of the tree at a time instead of scanning a long flat list.
3. As a user, I want Staged/Changes/Untracked to remain visually distinct
   collapsible sections (not merged into one tree), so I don't lose track of
   which bucket a file is in.

## Why this needed both automated tests and a live-browser pass

Two different kinds of logic were touched, and this repo has an established,
deliberate split for how each kind gets verified:

- **Pure tree-flattening logic** (`presentation/ChangesTree.kt`) has no
  Compose/UI dependency, so it got real RED → GREEN unit tests, same as the
  existing `domain/FileTreeNode.kt` (see `FileTreeTest.kt`) it builds on.
- **Compose UI** (`ui/web/WebMainPane.kt`, `ui/web/ChangesRail.kt`) is in the
  `com.tanyudii.tmuxweb.ui` package, which `kmp/composeApp/build.gradle.kts`'s
  `kover.reports.filters.excludes` deliberately excludes from the coverage
  gate ("automated UI-tree tests have limited value on these targets... a
  deliberate scope call, not a gap"). This matches `CLAUDE.md`'s standing,
  incident-driven instruction for this repo: UI-affecting changes must be
  rebuilt (`wasmJsBrowserDistribution`) and driven with real headless
  Chromium before being reported done, since compile+detekt+unit tests have
  historically missed real runtime bugs in this exact area (xterm.js interop,
  Popup/Dialog-over-terminal). Verification here followed that instruction.

## Task report

### 1. `buildChangeRows` — RED → GREEN → refactor (real unit tests)

- **RED**: `composeApp/src/commonTest/kotlin/.../presentation/ChangesTreeTest.kt`
  written first, referencing not-yet-existing `buildChangeRows`/`ChangeRow`.
  `./gradlew :composeApp:jvmTest --tests "...ChangesTreeTest"` failed with a
  compile error (`Unresolved reference 'buildChangeRows'`, `'ChangeRow'`) —
  valid compile-time RED per the workflow's own criteria (the failure was
  caused by the missing implementation, not unrelated breakage).
- **GREEN**: implemented `presentation/ChangesTree.kt` — reuses the existing,
  already-tested `domain.buildFileTree`/`FileTreeNode` per Staged/Changes/
  Untracked section, then flattens into one ordered row list honoring
  per-folder and per-group collapse state (`Set<String>` of
  `"group:<MODE>"` / `"<MODE>:<path>"` keys). Rerun: all 8 tests passed
  (`test-results/jvmTest/TEST-com.tanyudii.tmuxweb.presentation.ChangesTreeTest.xml`,
  `tests="8" failures="0" errors="0"`).
- **Refactor**: replaced an obscure `Triple(...) { lambda }` trailing-lambda
  call with a small private `ChangeSection` data class. Reran tests — still
  green — then confirmed coverage.
- **Coverage**: `./gradlew :composeApp:koverXmlReportJvm` →
  `com/tanyudii/tmuxweb/presentation/ChangesTreeKt`: 156/156 instructions,
  12/12 branches, 24/24 lines, 7/7 methods — **100%**.

### 2. Layout restructure + tree UI — live-browser verified (per repo policy)

- `WebMainPane.kt`: `ChangesRail` is now a full-height sibling of a new
  `MainContent` composable (TopBar + WindowTabs + terminal + StatusFooter),
  instead of being stacked in a `Row` below `WindowTabs`. `MainContent` was
  split out purely to keep `WebMainPane` under this repo's detekt
  `LongMethod`/line-count thresholds, mirroring how `WindowActionDialogs` was
  already split out of `WindowTabs.kt` for the same reason.
- `ChangesRail.kt` (new file, split out of `WebMainPane.kt` for the same
  detekt-threshold reason): renders `buildChangeRows`'s flattened rows as one
  `LazyColumn`, with group headers (chevron + label + count) and folder/file
  rows (chevron for folders, status-letter marker for files, depth-based
  indentation) — mirrors `WebSidebar.kt`'s `ProjectNode`/`SidebarRow` pattern.
- **Static checks**: `./gradlew :composeApp:compileKotlinWasmJs` and
  `:composeApp:jvmTest` both green; `:composeApp:detektMetadataCommonMain`
  clean on both touched files (only pre-existing, unrelated findings remain,
  in build-generated `Res.kt`/`ExpectResourceCollectors.kt` — confirmed
  present before this change too).
- **Live verification**: rebuilt `./gradlew :composeApp:wasmJsBrowserDistribution`
  (BUILD SUCCESSFUL), started an isolated `tmuxweb` instance (throwaway
  `HOME`, port 15320, throwaway git repo with staged/unstaged/untracked
  changes spread across nested folders — `src/foo/{a,b}.ts`, `src/baz/d.ts`,
  root `untracked-root.txt`), registered the project + created a session via
  the real HTTP API, then drove the UI with `playwright-core` against a
  cached Chromium binary (`~/.cache/ms-playwright/chromium-1228`), same
  pattern as `.claude/tdd/session-switch-terminal-stuck.tdd.md`. Compose Web
  renders to a `<canvas>`, so clicks were dispatched via `page.mouse.click`
  at each target's accessibility-tree bounding box (plain Playwright
  `locator.click()` is blocked by the canvas intercepting pointer events).

## Test specification

| # | What is guaranteed | Verification | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | `buildChangeRows(null, ...)` / all-empty `GroupedChanges` return no rows | `ChangesTreeTest.kt` | unit | PASS | `TEST-...ChangesTreeTest.xml` |
| 2 | Each non-empty section gets exactly one `GroupHeader` row, in Staged→Changes→Untracked order, empty sections skipped | `ChangesTreeTest.kt` | unit | PASS | same |
| 3 | Nested folders expand under their folder node at the correct depth when not collapsed | `ChangesTreeTest.kt` | unit | PASS | same |
| 4 | Collapsing a folder key hides its descendants but keeps the folder row | `ChangesTreeTest.kt` | unit | PASS | same |
| 5 | Collapsing a group key hides all its rows except the header | `ChangesTreeTest.kt` | unit | PASS | same |
| 6 | Same folder name in different sections does not cross-collapse (independent keys per mode) | `ChangesTreeTest.kt` | unit | PASS | same |
| 7 | Group header count reflects total file count regardless of collapse state | `ChangesTreeTest.kt` | unit | PASS | same |
| 8 | The Changes rail is a full-height right sidebar starting flush at the top — no empty strip above it even with a single tmux window open | Live Playwright + headless Chromium | manual/live E2E | PASS | `evidence/changes-rail-01-full-height-no-gap.png` |
| 9 | The "Changes" top-bar toggle opens/closes the rail | Live Playwright | manual/live E2E | PASS | `evidence/changes-rail-02-toggle-closed.png`, `-03-toggle-reopened.png` |
| 10 | STAGED/CHANGES/UNTRACKED group headers show correct counts and collapse/expand on click | Live Playwright | manual/live E2E | PASS | `evidence/changes-rail-04-group-collapsed.png`, `-05-group-reexpanded.png` |
| 11 | Collapsing a folder under one section leaves the same-named folder under another section expanded (visual confirmation of guarantee #6) | Live Playwright | manual/live E2E | PASS | `evidence/changes-rail-06-folder-collapsed-scoped-per-section.png`, `-07-folder-reexpanded.png` |
| 12 | Clicking a file row opens the diff dialog with the correct file path, mode badge, and diff content | Live Playwright | manual/live E2E | PASS | `evidence/changes-rail-08-file-click-opens-diff.png` |
| 13 | Terminal remains genuinely responsive (accepts real keystrokes, executes them) after the diff dialog is opened and closed — regression check against the Popup/Dialog-over-terminal incident class named in `CLAUDE.md` | Live Playwright, typed `echo VERIFY_TERMINAL_OK` and confirmed the echoed output | manual/live E2E | PASS | `evidence/changes-rail-09-terminal-responsive-after-dialog.png` |

## Coverage and known gaps

- `ChangesTreeKt` (the new pure logic): 100% instruction/branch/line/method
  coverage per `koverXmlReportJvm`.
- `ui.web.WebMainPane`/`ui.web.ChangesRail`: no Kover number applies — both
  are in a package explicitly excluded from the coverage gate by this
  project's existing, documented policy (see "Why this needed both..."
  above). This is consistent with the project's established testing
  strategy, not a new gap.
- The Playwright driver scripts and throwaway git repo/worktree used for
  verification are ephemeral (session scratchpad), per this repo's existing
  convention (`session-switch-terminal-stuck.tdd.md`) of doing this kind of
  manual/live QA ad hoc each session rather than maintaining a permanent E2E
  suite.
- Design decision flagged during planning and not overridden by the user:
  Staged/Changes/Untracked were kept as three separate collapsible tree
  sections (matching VS Code's Source Control panel) rather than merged into
  one path-based tree, to avoid conflating staged/unstaged/untracked status.

## Note on shared worktree

This worktree had other, unrelated in-progress changes on disk throughout
this session (a mobile-screens/design-system refactor, and a separate
terminal session-switch bug fix — see
`.claude/tdd/session-switch-terminal-stuck.tdd.md`). Every commit made for
this task staged only the specific files this task touched
(`ChangesTreeTest.kt`, `ChangesTree.kt`, `WebMainPane.kt`, `ChangesRail.kt`) —
never a blanket `git add -A` — so none of that other work was included or
disturbed.
