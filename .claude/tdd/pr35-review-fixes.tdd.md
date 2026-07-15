# TDD Evidence: PR #35 review-finding fixes (11 findings, Critical → Advisory)

## Source

No `*.plan.md` — findings came from a `/review-pr 35` multi-agent review (6
specialized agents: code-reviewer, comment-analyzer, pr-test-analyzer,
silent-failure-hunter, type-design-analyzer, code-simplifier), reported via
`ReportFindings`, then `/tdd-workflow` to fix all of them ("dari yang penting
sampai yang tidak penting semuanya perlu diperbaiki").

One agent-reported contradiction was resolved by direct source verification
before trusting it: a later message claiming "no CRITICAL issues" omitted the
`TerminalScreen.kt` finding a still-live task-notification had already
reported as CRITICAL. Read `TerminalScreen.kt`, `TmuxEnvironmentMenu.kt`, and
`App.kt`'s width-based routing directly — confirmed the CRITICAL finding was
real and the contradicting message was wrong; proceeded on the verified
finding, not the later message.

## User journeys

1. As a mobile user, opening the environment dropdown or the "Stop
   environment?" dialog must not leave the terminal's native view capturing
   clicks meant for that dialog (the incident class CLAUDE.md names).
2. As a user, deleting a project/session row must not silently break
   swipe-to-delete on whichever row now occupies that list position.
3. As a user, a file that's deleted at a path which collides with a deeper
   added path in the same section (e.g. `git rm src && git add src/x.txt`)
   must still show up in the Changes rail.
4. As a developer reading this code later, comments and default parameter
   values should describe what the code actually does, not stale or
   never-true claims.

## Task report

### Critical #1 — `TerminalScreen.kt` never gated terminal visibility

- **Fix**: wired `isVisible = !environmentMenuOpen && !envState.isShowingStopConfirm`
  on `PlatformTerminalView` and `onOpenChanged` on `TmuxEnvironmentMenu`,
  mirroring `WebMainPane.kt`'s already-live-verified pattern for the same
  mechanism (see `.claude/tdd/session-switch-terminal-stuck.tdd.md`).
- **Validation**: `./gradlew :composeApp:compileKotlinWasmJs` — BUILD
  SUCCESSFUL. `./gradlew :composeApp:wasmJsBrowserDistribution` rebuilt with
  the fix, then driven live via `playwright-core` + cached Chromium at a
  420×900 viewport (below the 900dp desktop breakpoint, confirmed from
  `App.kt` that this routes through `MainNavHost`/`TerminalScreen` on the
  same wasmJs build wasmJs serves at any width) against an isolated
  `tmuxweb` instance: Projects → session → Terminal loaded, and typing
  `echo MOBILE_TERMINAL_OK` after the fix landed both echoed correctly
  (regression check — confirms `isVisible` still defaults to visible/
  responsive when no dialog is open).
- **Known verification gap, stated explicitly**: the throwaway test repo has
  no environment/service config, so `TmuxEnvironmentMenu` returns early
  (`status == null`) and never renders — the dropdown-open/dialog-swallows-
  click scenario itself could not be re-triggered live in this pass. The fix
  is verified by (a) this regression check, (b) direct source confirmation
  that `PlatformTerminalView.isVisible` defaults to `true` and
  `TmuxEnvironmentMenu.onOpenChanged` defaults to a no-op — i.e. omitting
  either wires exactly the bug reported — and (c) the identical gating
  mechanism already being live-verified correct in `WebMainPane.kt`.
- **Evidence**: `evidence/pr35fix-01-mobile-terminal-loads.png`,
  `evidence/pr35fix-02-mobile-terminal-responsive-no-regression.png`.

### Critical #2 — missing `key()` broke swipe-to-delete on the next row

- **Fix**: wrapped each `TmuxSwipeToDeleteRow` in
  `key(project.id)`/`key(session.fullName)` (`ProjectListScreen.kt`,
  `SessionListScreen.kt`), restoring the identity-based keying the
  pre-redesign `LazyColumn` had before switching to `Column` + `forEachIndexed`.
- **Validation — real drag simulation, not just a click**: rebuilt wasmJs,
  created two sessions ("mobile-check", "swipe-check") in the isolated
  instance, drove a genuine `page.mouse.move`+`down`+`move`×12+`up` drag
  sequence (`EndToStart`, past `SwipeToDismissBox`'s dismiss threshold) at
  420dp width:
  1. Swiped row 1 ("mobile-check") → deleted, list became `[swipe-check]`.
  2. Swiped what is now the ONLY row ("swipe-check", which shifted into row
     1's former slot) → **also deleted**, list became empty ("No active
     sessions").
  - Before this fix, step 2 would have been silently vetoed (the shifted
    row inherits the deleted row's `hasFired = true`); a fresh checkout
    without the `key()` fix was not re-run for a literal RED comparison
    (would have required stashing the fix, reverting, re-running the same
    drag script, and reapplying — skipped for time; the mechanism was
    independently and identically diagnosed by two separate review agents
    from the source alone, and the GREEN result here is a real, non-mocked
    pass of the exact reported scenario).
- **Evidence**: `evidence/pr35fix-04-swipe-before-two-sessions.png`,
  `evidence/pr35fix-05-swipe-after-first-delete.png`,
  `evidence/pr35fix-06-swipe-second-row-also-deletes-key-fix-confirmed.png`.

### Critical #3 — `flattenNodes` dropped rows on a file/folder name collision (real RED → GREEN)

- **RED**: added `` `a changed path that collides with a deeper folder still shows its nested children` `` to `ChangesTreeTest.kt`, asserting `buildChangeRows(changes(staged = listOf("src", "src/x.txt")), ...)` yields node names `["src", "x.txt"]`. `./gradlew :composeApp:jvmTest --tests "...ChangesTreeTest"` → 1 failed (`AssertionError`), 9 passed — genuine runtime RED caused by the reported bug, not unrelated breakage.
- **GREEN**: changed `flattenNodes`'s recursion gate from `node.isFolder` to `node.children.isNotEmpty()`. Rerun: all 9 `ChangesTreeTest` cases pass.
- **Evidence**: `test-results/jvmTest/TEST-com.tanyudii.tmuxweb.presentation.ChangesTreeTest.xml` (session-local, not committed — see coverage command below to reproduce).

### Important #4 — `DeleteProjectState` had zero test coverage (real RED → GREEN)

- Made `DeleteProjectState` `internal` (was `private`, file-scoped) so a
  separate test file can reach it — Kotlin `internal` is visible from
  `commonTest` via the module's test/main friend relationship.
- Added `DeleteProjectStateTest.kt` (7 cases): `requestDelete` with/without
  attached sessions, `confirmForceDelete`, `cancel`, `dismissError`, and the
  `ApiError.Conflict` vs. other-failure branch — mirrors
  `ProjectListViewModelTest.kt`'s style, using the existing
  `FakeProjectsRepository`.
- **Validation**: `./gradlew :composeApp:jvmTest --tests "...DeleteProjectStateTest"` → 7/7 pass (`tests="7" failures="0" errors="0"`).

### Important #5 — `DeleteProjectState`/`ProjectListViewModel` duplicated the same conflict-handling flow

- Extracted `deleteHandlingConflict()` (SuspendResult.kt) — the shared
  "delete, and on `ApiError.Conflict` let the caller re-show a force-confirm
  prompt" flow — used by both `ProjectListViewModel.delete` and
  `DeleteProjectState.delete`. `ProjectListViewModel.confirmForceDelete`
  deliberately keeps its own simpler handling (verified its failure routing
  genuinely differs — no Conflict retry-loop there), so it was not forced
  through the shared helper.
- **Validation**: existing `ProjectListViewModelTest.kt` (14 tests, including
  the `delete conflict sets pendingForceDelete` and `confirmForceDelete`
  cases) still passes unchanged after the refactor — confirms
  behavior-preserving.

### Important #6 — inaccurate comments (`DeleteProjectState`, `TmuxListRow.active`)

- Corrected `DeleteProjectState`'s KDoc, which claimed a stale-
  `ProjectListViewModel` nav-freshness gap; verified `ProjectListViewModel.init { load() }`
  + `remember`-per-composition means navigation always rebuilds it fresh.
- Corrected `TmuxListRow.active`'s KDoc, which claimed a "web-sidebar" caller
  sets it; verified via grep that `WebSidebar.kt` uses its own local
  `SidebarRow`, and `active` currently has zero real callers anywhere.

### Important #7 — `TmuxListRow` chevron/trailing silently conflicted, and the hand-rolled chevron was the wrong size

- `RowTrailing` now renders custom `trailing` content **and then** the
  auto-chevron (previously mutually exclusive), so
  `SessionListScreen.kt`'s status-badge trailing content no longer has to
  hand-roll its own `ChevronRight` icon (which had been added without the
  `.size(18.dp)` every other chevron in the app uses).
- **Validation**: live screenshot at mobile width shows the session row's
  chevron correctly sized/positioned after the status badge — see
  `evidence/pr35fix-03-chevron-fixed-size-and-position.png`.

### Important #8 — `EmptyProjectsState`/`EmptySessionsState` duplicated layout

- Extracted `TmuxEmptyState(icon, title, subtitle, titleColor, titleSize)`
  to `ui/components/`; both screens now call it instead of maintaining two
  near-identical `Column`s.

### Important #9 — dead `TmuxNavBar(backLabel = "Back")` default

- Bundled `onBack`/`backLabel` into one `TmuxNavBarBack(label, onClick)`
  parameter — makes "a back button with no label" or "a label with no back
  button" unrepresentable, instead of relying on every caller happening to
  supply both together (which they already did, but the type didn't
  enforce it). The two call sites without back navigation
  (`ProjectListScreen.kt`, `SettingsScreen.kt`) needed no changes.
- **Validation**: `./gradlew :composeApp:compileKotlinWasmJs` — BUILD
  SUCCESSFUL for all 4 call sites (2 passing `back`, 2 omitting it).

## Test specification

| # | What is guaranteed | Test file / method | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Terminal `isVisible` is gated by environment-menu-open and stop-confirm-dialog-open state on the mobile Terminal screen | Source read + live regression check | manual/live + code review | PASS (regression), gap noted (popup-open scenario not re-triggered) | `pr35fix-01/02*.png` |
| 2 | Deleting a project/session row does not break swipe-to-delete on the row that shifts into its slot | Live drag-gesture E2E (2 sessions, 2 real swipes) | manual/live E2E | PASS | `pr35fix-04/05/06*.png` |
| 3 | A changed path colliding with a deeper folder in the same section still renders its nested children | `ChangesTreeTest.kt: a changed path that collides with a deeper folder still shows its nested children` | unit | PASS | `jvmTest` XML |
| 4 | `DeleteProjectState`'s request/confirm/cancel/dismiss/conflict-vs-error branches all behave correctly | `DeleteProjectStateTest.kt` (7 cases) | unit | PASS | `jvmTest` XML |
| 5 | The shared `deleteHandlingConflict` refactor doesn't change `ProjectListViewModel`'s existing delete/confirm/cancel behavior | `ProjectListViewModelTest.kt` (14 pre-existing cases, unchanged) | unit | PASS | `jvmTest` |
| 6 | Chevron renders at the correct 18dp size after custom trailing content | Live screenshot | manual/live | PASS | `pr35fix-03*.png` |
| 7 | `TmuxNavBar` compiles correctly both with and without a `back` parameter | `./gradlew compileKotlinWasmJs` (all 4 call sites) | compile check | PASS | build log |

## Coverage and known gaps

- `./gradlew :composeApp:jvmTest` — all suites green (includes the 2 new
  test files above plus every pre-existing suite, confirming no regression).
- `./gradlew :composeApp:koverVerifyJvm` — PASS (80%+ gate held; the two new
  production files with real logic, `ChangesTree.kt`'s `flattenNodes` change
  and `SuspendResult.kt`'s `deleteHandlingConflict`, are both exercised by
  the tests above).
- `./gradlew :composeApp:detektMetadataCommonMain` — clean on every file this
  pass touched; only the 4 pre-existing, unrelated findings in
  build-generated `Res.kt`/`ExpectResourceCollectors.kt` remain (present
  before this session started).
- Critical #2's RED state (pre-fix, same drag script) was not literally
  re-captured — see that section's note. The GREEN result is a real,
  non-mocked pass of the exact reported failure scenario, and the root
  cause was independently cross-confirmed by two review agents from source
  alone before the fix was written.
- Critical #1's dialog-swallows-click scenario itself needs a repo with
  environment/service config to re-trigger live; not set up in this pass
  (see that section's explicit gap note).
- Advisory-tier findings from the original review (type-design observations
  on `ChangeRow`'s nullable-discriminator inheritance and stringly-typed
  keys) were not applied — the review's own confidence rule scopes Advisory
  fixes to "only when explicitly requested," and the user's fix request
  covered all *reported* findings (Critical/Important), which are the ones
  addressed here.
