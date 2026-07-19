# TDD Evidence: Option-drag select + auto-scroll -> OS clipboard

**Source**: conversational `/plan` (no `*.plan.md` file) — see session transcript for the full restatement, live spike, and design pivot.

## User journey

As a Mac user, I want to hold Option and drag-select terminal output that's
longer than one screen, so that releasing the mouse near the top/bottom edge
keeps revealing more content, and Cmd+C copies the full selection to my real
OS clipboard.

## What changed and why (design pivot)

The original plan (reuse xterm.js's own local browser selection + a custom
edge-auto-scroll requester) was abandoned after a live spike proved xterm's
local selection is anchored to buffer (row, col) coordinates that tmux
silently overwrites on repaint — a multi-screen selection's full text is
never simultaneously present in one buffer to reconstruct. The shipped fix
instead lets Option-drag fall through to tmux's own native copy-mode
(`macOptionClickForcesSelection` removed from `XtermJs.kt`), which already
auto-scrolls correctly (a real tmux feature), and relays tmux's resulting
paste buffer to the OS clipboard via a new REST endpoint, consumed by Cmd+C.

## Task report

| # | Task | Validation run | Result |
|---|------|-----------------|--------|
| 1 | `dragEdgeScrollLines` math (superseded design, reverted via `git revert` after the pivot) | `./gradlew :composeApp:wasmJsTest` | Implemented, then cleanly reverted — see commits `38fd5ff`/`7947b00`/`6c62f64` and their reverts `b1e7c67`/`593de5e`/`e729f44` |
| 2 | `readPasteBuffer` (src/tmux.ts) | `node --test src/tmux.test.ts` | PASS (47/47) |
| 3 | `getProjectSessionPasteBuffer` (src/project-sessions.ts) | `node --test src/project-sessions.test.ts` | PASS (44/44) |
| 4 | `GET .../paste-buffer` route (src/server.ts) | `node --test src/server.test.ts` | PASS (145/145) |
| 5 | Client wiring: `attachOptionDragCaptureListener`, `captureSelection`, Cmd+C fallback | `./gradlew :composeApp:wasmJsTest`, `detekt`, `compileKotlinJvm` | PASS |
| 6 | Cross-session race narrowing (`delayFn` settle delay) | `node --test src/tmux.test.ts` | PASS (47/47) |
| 7 | Full-stack live verification (real headless Chromium, real Compose UI, real tmux server) | See "Live verification" below | PASS with one caveat, one bug found+fixed |

## Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|---|---|---|---|
| 1 | `readPasteBuffer` returns tmux's paste buffer text verbatim via `save-buffer -` | `src/tmux.test.ts:readPasteBuffer returns tmux's paste buffer text verbatim` | unit | PASS |
| 2 | `readPasteBuffer` propagates a real tmux error (e.g. no buffer set) | `src/tmux.test.ts:readPasteBuffer propagates the error...` | unit | PASS |
| 3 | `readPasteBuffer` waits for `delayFn` before reading, narrowing the cross-session race | `src/tmux.test.ts:readPasteBuffer waits for delayFn...` | unit | PASS |
| 4 | `getProjectSessionPasteBuffer` validates the session slug before reading | `src/project-sessions.test.ts:...validates the session slug...` | unit | PASS |
| 5 | `getProjectSessionPasteBuffer` returns the buffer text for a valid slug | `src/project-sessions.test.ts:...returns deps.readPasteBuffer's text...` | unit | PASS |
| 6 | `GET .../paste-buffer` requires auth (401) | `src/server.test.ts:...without a token returns 401` | integration | PASS |
| 7 | `GET .../paste-buffer` returns the buffer text (200) | `src/server.test.ts:...returns the buffer text` | integration | PASS |
| 8 | `GET .../paste-buffer` returns 404 for an unknown project | `src/server.test.ts:...unknown project` | integration | PASS |
| 9 | `GET .../paste-buffer` returns 400 for an invalid session slug | `src/server.test.ts:...invalid session slug` | integration | PASS |
| 10 | `dragEdgeScrollLines` edge math (superseded, kept only as historical RED/GREEN evidence — file reverted) | `kmp/.../TerminalSelectionAutoScrollTest.kt` (reverted) | unit | superseded |

## Live verification (E2E, real headless Chromium against the real app)

A dedicated live-browser pass (mandatory per this repo's `CLAUDE.md` for
Compose Web UI changes) drove the actual Compose UI end-to-end against a
real tmux server with a `seq 1 500` session:

- **Option-drag now routes to tmux's own copy-mode** (not a local xterm
  selection): confirmed via `tmux save-buffer -` returning real dragged
  content (`457..466`), with xterm's own `hasSelection()` false.
- **Cmd+C writes the correct text to the real OS clipboard**:
  `navigator.clipboard.readText()` matched the dragged lines exactly; the
  app's own "Copied" toast rendered.
- **Plain (non-Option) drag regression**: confirmed zero `paste-buffer`
  requests fired — unchanged behavior.
- **Auto-scroll itself**: not directly demonstrable via synthetic
  Playwright pointer events (CDP does not keep delivering motion once the
  simulated pointer leaves the element's bounds, so tmux's own edge-timer
  logic never re-triggers) — this is a synthetic-input tooling gap, not an
  app-code gap; tmux's own copy-mode auto-scroll is an unmodified,
  pre-existing tmux feature. A manual check on a real Mac browser is the
  only way to observe this specific step directly.
- **Bug found and fixed as a result**: `readPasteBuffer` read the tmux
  server's globally-newest buffer with no session scoping, and a real race
  (~14ms) let an unrelated concurrent session's copy get relayed instead of
  the user's own, on a shared tmux server with many active sessions. Fixed
  by task 6 above (settle delay + corrected doc comment); a fully
  session-scoped fix would require rebinding tmux's own mouse keytables
  per-session, judged too invasive (would affect the user's own tmux
  customizations outside this app) and not attempted.

## Coverage and known gaps

- All new pure logic (`readPasteBuffer`, `getProjectSessionPasteBuffer`, the
  REST route) has unit/integration coverage per the table above.
- The wasmJs DOM/JS-interop glue (`attachOptionDragCaptureListener`, the
  Cmd+C fallback wiring) has no unit tests, consistent with this codebase's
  existing convention for this class of code (e.g. `attachTouchScroll` has
  none either) — it is verified live instead (see above).
- Auto-scroll's exact visual behavior is verified only by inference (tmux's
  own copy-mode is engaged, and that feature is unmodified/pre-existing) —
  not by direct observation. Recommend a quick manual check on a real Mac
  browser before considering this fully closed, if that assurance matters.
