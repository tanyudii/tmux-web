# TDD Evidence: GitHub-PR-style diff viewer (KMP Web UI)

**Source plan**: inline plan produced by `/ecc:plan` this session (no `*.plan.md` file
written — conversational mode). Summary: wire a diff-detail dialog into the
already-existing `ChangesRail`, ported from the legacy `public/diff-parser.js`
algorithm (commit `94514e6`, removed from the repo in `2d3b55c`'s cutover to
`kmp/`). No backend changes were needed — `src/git-status.ts` and the
`/changes`/`/diff` endpoints already existed and were already wired end-to-end
through `ChangesRepository`/`ChangesViewModel`; only the diff-detail UI was
missing.

## User journeys

- As a user reviewing uncommitted work, I want to click a changed file in the
  Changes rail and see its diff rendered like a GitHub PR review (line
  numbers, added/removed/context lines, highlighted), so I can review before
  committing.
- As a user, I want the same view for staged, unstaged, and untracked files.
- As a user, closing the diff view must not leave the terminal unresponsive
  (the class of regression called out in this repo's `CLAUDE.md`).

## Task report

| # | Task | Validation command | Result |
|---|------|--------------------|--------|
| 1 | Hunk-aware unified diff parser (`parseUnifiedDiff`, `parsedDiffFromAdditions`, `computeLineWordDiff`, `withIntralineHighlights`) | `./gradlew :composeApp:jvmTest --tests "com.tanyudii.tmuxweb.domain.DiffLineParserTest"` | RED (compile error, unresolved references) → GREEN (12/12 passing) → REFACTOR (detekt clean) |
| 2 | `DiffViewModel` (one-shot load + parse per file/mode) | `./gradlew :composeApp:jvmTest --tests "com.tanyudii.tmuxweb.presentation.DiffViewModelTest"` | RED (compile error, `DiffViewModel` unresolved) → GREEN (5/5 passing) |
| 3 | `TmuxDiffDialog` UI + `WebMainPane`/`ChangesRail` wiring | `./gradlew :composeApp:compileKotlinJvm` + live Playwright verification | No automated RED/GREEN cycle possible (no Compose UI test harness in this repo — see "Known gap" below); verified live instead |

## Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|---------------------|-----------|------|--------|
| 1 | A single hunk's add/del/context lines are classified and counted correctly | `DiffLineParserTest.kt:"parses a single hunk..."` | unit | PASS |
| 2 | Old/new line numbers advance independently across add/del/context | `DiffLineParserTest.kt:"numbers old and new lines independently..."` | unit | PASS |
| 3 | Pre-hunk noise (`diff --git`, `index`, `---`, `+++`) is skipped | `DiffLineParserTest.kt:"lines before the first hunk header are skipped"` | unit | PASS |
| 4 | Multiple hunks in one file are all parsed, with per-hunk stats summed | `DiffLineParserTest.kt:"handles multiple hunks in one file"` | unit | PASS |
| 5 | `\ No newline at end of file` becomes a META row, not a content row | `DiffLineParserTest.kt:"keeps a trailing no-newline marker..."` | unit | PASS |
| 6 | Untracked files render every line as a synthetic addition starting at line 1 | `DiffLineParserTest.kt:"parsedDiffFromAdditions renders..."` | unit | PASS |
| 7 | Intraline word diff marks only the changed word(s), not the whole line | `DiffLineParserTest.kt:"computeLineWordDiff marks only..."` | unit | PASS |
| 8 | Equal-length del/add runs get paired intraline segments; unequal runs don't | `DiffLineParserTest.kt:"withIntralineHighlights pairs..."` / `"...leaves unequal-length..."` | unit | PASS |
| 9 | `DiffViewModel` loads and parses a real diff on init | `DiffViewModelTest.kt:"loads and parses a real diff on init"` | unit | PASS |
| 10 | Untracked/binary `FileDiff` responses route to the correct rendering path | `DiffViewModelTest.kt:"untracked file renders..."` / `"binary file has no parsed diff"` | unit | PASS |
| 11 | A failed diff fetch surfaces `errorMessage`, not a crash | `DiffViewModelTest.kt:"load failure surfaces an error message"` | unit | PASS |
| 12 | Clicking a modified file opens a dialog with correct stat bar (+2/−1), hunk header, line numbers, and intraline highlights matching the real `git diff` output | live Playwright run against `tmux-web-9c0d13__diffcheck-tmp` (real worktree, real uncommitted changes) | manual/E2E | PASS — see `diff1-dialog-open.png` |
| 13 | Clicking an untracked file renders the synthetic all-additions diff with the correct badge/stat | live Playwright run | manual/E2E | PASS — see `diff3-untracked-dialog.png` |
| 14 | Closing the dialog restores the rail/terminal and the terminal remains typable | live Playwright run (typed `echo diffcheck-terminal-ok` after two open/close cycles) | manual/E2E | PASS — see `diff4-terminal-after-close.png` |

## Coverage and known gaps

- `./gradlew :composeApp:jvmTest`: 150/150 passing (whole module, not just this
  feature's new tests).
- `./gradlew :composeApp:detektMetadataCommonMain`: clean for every file this
  feature touched or added (`DiffLineParser.kt`, `DiffLineParserTest.kt`,
  `DiffViewModel.kt`, `DiffViewModelTest.kt`, `TmuxDiffDialog.kt`,
  `WebMainPane.kt`). The 4 remaining findings are pre-existing generated-code
  noise in `Res.kt`/`ExpectResourceCollectors.kt`, present before this work
  started and unrelated to it.
- **Known, deliberate gap**: no automated test exists for `TmuxDiffDialog`'s
  Compose UI tree or `WebMainPane`'s click-wiring. This repo has no Compose UI
  test harness for any screen (`wasmJsTest` has no Chrome available for Karma
  in this sandbox; no other dialog in the codebase — `NewProjectDialog`,
  `TmuxConfirmDialog`, `TmuxDirectoryPickerDialog` — has a UI test either).
  Per this repo's standing `CLAUDE.md` mandate, the substitute for that gap is
  mandatory live verification: rebuilding the wasmJs bundle
  (`./gradlew :composeApp:wasmJsBrowserDistribution`) and driving it with real
  headless Chromium (Playwright) against the isolated dev instance on port
  5310, which was done for this feature (see task report above) — clicking
  both a modified and an untracked file, confirming the rendered diff content
  against the real `git diff`/`git status` ground truth, and confirming the
  terminal survives an open/close cycle.
- Real-world verification used a throwaway session
  (`tmux-web-9c0d13__diffcheck-tmp`) created specifically for this test and
  deleted afterward, to avoid touching any other project's or agent's live
  session (see this repo's incident history around shared worktree sessions).

## Merge evidence

Three checkpoint commits on `kmp-web-ui`, each scoped to only its own files
(never a broad `git add`, given substantial unrelated uncommitted work already
present in this worktree from prior sessions):

1. `ef78bfe` — hunk-aware parser (RED → GREEN → REFACTOR, all in one commit
   per the TDD workflow's "compact workflow" allowance).
2. `8c4c8b0` — `DiffViewModel` (RED → GREEN).
3. `6ac36a2` — `TmuxDiffDialog` UI + `WebMainPane` wiring (no RED/GREEN cycle;
   see "Known gap" above), plus the detekt cleanup this piece needed
   (`LongMethod` on `WebMainPane`, `TooManyFunctions` on `TmuxDiffDialog.kt`).
