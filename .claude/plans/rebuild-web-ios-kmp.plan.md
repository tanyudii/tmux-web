# Plan: Rebuild Web + iOS Clients with Kotlin Multiplatform

**Source**: conversational `/plan` request (no PRD file)
**Complexity**: Large
**Scope confirmed with user**:
- Backend (`src/`, Node.js/TypeScript) stays **unchanged**. It is the frozen contract both new clients build against.
- Both existing clients — `public/` (vanilla JS + xterm.js) and `ios/TmuxWebClient` (SwiftUI + SwiftTerm) — are replaced by **one new Kotlin Multiplatform project** that shares UI via **Compose Multiplatform** across an iOS target and a Web (Kotlin/Wasm) target.

## Progress log

- **Phase 0 — complete.** All four spikes resolved; ADRs written
  (`docs/adr/0001`–`0003`). Terminal embedding proven end-to-end on Web (real
  headless-Chrome keyboard round trip through `HtmlElementView` + xterm.js);
  iOS side compiles via `compileKotlinIosSimulatorArm64` on Linux (Kotlin/Native
  can cross-compile without Xcode) but linking/Swift interop naming remain
  unverified until the CI macOS runner runs. Navigation settled without a
  spike (`navigation-compose` 2.9.2 confirmed wasmJs-published from research).
  Dependency versions locked in `kmp/gradle/libs.versions.toml` — Kotlin
  2.3.20, Compose Multiplatform 1.11.1, Ktor 3.5.1, Koin 4.1.0.
- **Phase 1 — foundation done.** Koin wired (`commonModule` + `initKoin()`,
  called from both platform entry points, verified by a passing test —
  intentionally left with empty bindings until Phase 2 has real
  repositories/ViewModels to bind). Kover wired and `koverVerify`'s 80% gate
  currently passes trivially — there's almost no real business logic yet to
  cover, so this isn't a meaningful signal until Phase 2 lands domain/data
  code; noted here so it isn't mistaken for a real coverage milestone. Detekt
  configured across all KMP source sets with a `FunctionNaming` exception for
  `@Composable`s. The Phase-0-only `spike-ws` module was removed per its own
  "delete before Phase 1" note. `kmp-ci.yml` (Linux + macOS jobs) written but
  not yet run for real — first real CI run is the next actual verification
  gate for the iOS side.
- **Phase 2 — shared domain & data layer, complete.** All models in §2.4 ported
  with kotlinx.serialization (`domain/model/`); `ClientMessage` (terminal
  protocol, incl. `scroll` — the gap identified in §2.6 that iOS's Swift
  client never had), `FileTreeNode`/`buildFileTree`, and `parseDiffLines`
  ported as pure, fully-tested logic; four repositories
  (Projects/Sessions/Changes/Environment) with Ktor implementations behind a
  shared `TmuxWebHttpClient` that centralizes the status-code → `ApiError`
  mapping; `TokenStore` expect/actual (Web: `localStorage`, tested for real;
  iOS: Keychain via direct `Security.framework` cinterop, compiles via
  `compileKotlinIosSimulatorArm64` but — like ADR 0001's SwiftTerm bridge —
  unverified at runtime until CI/a real device). Every test case is a direct
  port of the existing Swift test tables (`ClientMessageTests`,
  `FileTreeTests`, `DiffDetailViewTests`, `APIClientTests`'s status-mapping
  assertions) using Ktor's `MockEngine` as the Kotlin equivalent of
  `StubURLProtocol`. **32 tests, 0 failures, 0 skipped**, verified via a real
  headless-Chrome run (`wasmJsTest`), not just "compiles."
- **Phase 3 — presentation layer, code complete; browser-test verification
  blocked.** Six ViewModels added under `presentation/`: `ProjectListViewModel`
  and `SessionListViewModel` (load/delete/force-delete-on-409 state machines,
  the latter also owning `NewSessionSheet.swift`'s 1s creation-progress poll),
  `TerminalViewModel` (connect/reconnect/disconnect over a new `TerminalSocket`
  abstraction + `KtorTerminalSocket` real implementation, input/resize/scroll
  sending, and the bell-alert cooldown via a new pure `domain/BellAlert.kt`
  port of `public/notify.js`), `ChangesViewModel` (5s poll) and
  `EnvironmentViewModel` (3s poll, silent-on-poll-failure per
  `EnvironmentBar.swift`), and `ConnectionSettingsViewModel` (new
  `parseServerUrl` pure validator + a new `BaseUrlStore` expect/actual and
  `ConnectionSettingsStore`/`ConnectionTester` interfaces — filling a gap left
  open in Phase 2, where only the token half of `ConnectionSettings` was
  built). Every ViewModel is unit-tested against fakes with
  `kotlinx-coroutines-test` (`UnconfinedTestDispatcher` for immediate
  state machines, `StandardTestDispatcher` + `advanceTimeBy`/`advanceUntilIdle`
  for the poll-driven ones) and Turbine, AAA-structured, ~60 new test cases
  across 8 test files. Both `detekt` and `compileKotlinIosSimulatorArm64` are
  clean. **However**, `wasmJsTest` (the real headless-Chrome run that gave
  Phases 1–2 their "not just compiles" evidence) is currently **failing in
  this dev sandbox for environment reasons, not code reasons**: Karma reports
  `Disconnected ... ping timeout` / `no message in 120000ms` after the
  webpack bundle builds successfully, with zero browser-side console or
  stderr output ever surfacing even with `--enable-logging=stderr` — Chrome
  150 (the locally cached binary) appears to fail to establish Karma's
  in-page client socket, and the root cause wasn't isolated after three
  attempts (extended Karma timeouts, a standalone `karma start` debug run,
  verbose Chrome logging). This is a regression from Phase 1/2's clean
  browser-verified runs in this same sandbox and is flagged here rather than
  papered over. `koverVerify` wasn't run either since its coverage data comes
  from this same `wasmJsTest` execution.
- **Next**: either resolve the local headless-Chrome/Karma environment issue
  (candidates: pin an older `ChromeHeadless`-compatible Chrome build, or debug
  via CI's macOS/Linux runner instead of this sandbox) and get a real
  `wasmJsTest` pass + `koverVerify` for Phase 3's new code, or explicitly
  accept the gap and move to Phase 4 (Shared Compose UI) with Phase 3 flagged
  as "compiles + statically clean, browser-execution unverified locally."

## 1. Requirements restatement

1. Rebuild the web frontend and the iOS app as a single KMP + Compose Multiplatform codebase, talking to the existing REST + WebSocket API unchanged.
2. Follow a standard, production-grade KMP architecture appropriate for a small/medium app — not over-engineered, but not a toy either. This is an explicit **learning goal**: the project itself should teach how a real KMP app is structured.
3. Documentation must be thorough: architecture doc, ADRs for the non-obvious decisions, per-module READMEs, and a TDD evidence report in the same style the repo already uses (`docs/testing/tmux-web.tdd.md`).
4. Development follows TDD (RED → GREEN → REFACTOR) throughout, with 80%+ coverage, per the user's global testing standard.

## 2. Pattern grounding (from the existing codebase)

An inventory pass over the backend and both existing clients (`src/server.ts`, `src/pty-bridge.ts`, `src/main.ts`, `src/log-stream.ts`, `src/session-env.ts`, `src/git-status.ts`, `src/project-sessions.ts`, all of `ios/TmuxWebClient/**`, `public/app.js`, `public/notify.js`, `public/terminal-clipboard.js`, `public/diff-parser.js`, `ios/TmuxWebClientTests/**`) produced the ground truth below. The new KMP client must reproduce this contract exactly — the backend will not change to accommodate it.

### 2.1 Auth
- REST: `Authorization: Bearer <token>` header. WebSocket: token as `?token=` query param (browsers can't set custom WS headers). Single shared token, constant-time compare server-side. 401 on REST is an **empty body**, not JSON.

### 2.2 REST endpoints (`src/server.ts`)
| Method | Path | Success | Key errors |
|---|---|---|---|
| GET | `/api/projects` | 200 `{projects: Project[]}` | 401 empty |
| POST | `/api/projects` | 201 `Project` | 400 missing fields / invalid repoPath |
| DELETE | `/api/projects/:id?force=` | 204 | 404 not found; 409 `{error, sessionCount}` if active sessions and no force |
| GET | `/api/projects/:id/sessions` | 200 `{sessions: ProjectSession[]}` | 404 |
| POST | `/api/projects/:id/sessions` | **202** `{name, fullName, phase:"creating"}` | 400; 409 creation already in progress |
| GET | `/api/projects/:id/sessions/:slug/creation` | 200 `SessionCreationStatus` | 404 |
| DELETE | `/api/projects/:id/sessions/:slug?force=` | 204 | 409 dirty worktree (needs force) |
| GET | `/api/projects/:id/sessions/:slug/changes` | 200 `GroupedChanges` | 404 worktree gone |
| GET | `/api/projects/:id/sessions/:slug/diff?path=&mode=` | 200 `FileDiff` | 400 missing/invalid params |
| GET\|POST\|DELETE | `/api/projects/:id/sessions/:slug/env` | 200/202/204 | 409 already running / not running; 404 env unavailable |

All error bodies are `{error: string}` (+ `sessionCount?: number` on the 409-active-sessions case). All session sub-resources are addressed by **`name`** (short slug), not `fullName`.

### 2.3 WebSocket protocol
Two upgrade paths, routed in `src/main.ts` by **pathname**, not headers:

- **`/ws?session=<fullName>&token=`** (terminal): client→server is JSON text: `{type:"input", data}` / `{type:"resize", cols, rows}` (positive ints only) / `{type:"scroll", direction:"up"|"down", lines}`. Server→client is **raw PTY bytes**, no framing at all. `scroll` drives server-side `tmux copy-mode` (there is no client-side scrollback — this is load-bearing, not incidental). A `scroll` "up" followed by any `input` triggers an implicit copy-mode-cancel server side.
- **`/ws/logs?project=&session=&token=&service=`** (logs): read-only, raw `docker compose logs --follow` text, no client→server messages at all.

### 2.4 Domain models (source of truth = TS types; Swift models mirror them 1:1 today)
`Project{id,name,repoPath,createdAt}`, `ProjectSession{name,fullName,windows,attached}`, `SessionCreationStatus{phase,message?,session?}` (`phase: creating|ready|error`), `GroupedChanges{staged,unstaged,untracked}` of `ChangedFile{path,oldPath?,status,staged}` (`status: modified|added|deleted|renamed|untracked`), `FileDiff{diff,isUntracked,isBinary}`, `EnvStatus{phase,openUrl?,message?,services?}` (`phase: unavailable|idle|starting|running|error|stopping`), `ComposeServiceStatus{service,state,health?}`.

### 2.5 Existing test suites = the acceptance contract
`ios/TmuxWebClientTests/*.swift` already encodes exact expected behavior (auth header, status→error mapping, resize/scroll validation incl. rejecting `cols:0`/`rows:-1`, file-tree grouping, diff line classification, keychain round-trip). **These become the literal source of the first RED tests when ported to Kotlin** — this rebuild has the unusual advantage of an existing, passing reference implementation to test against, not a blank spec.

### 2.6 Known client-parity gaps to make an explicit call on (not silently carry over or silently fix)
| Gap | Today | Decision for rebuild |
|---|---|---|
| Scroll → tmux copy-mode | Web sends `scroll` messages via wheel handler; iOS never does | **Unify**: implement once in shared code, wire trackpad/wheel (Web) and scroll gesture (iOS) to it |
| Bell alert | Web: title flash + Web Audio beep + `Notification` API, 1500ms cooldown; iOS: haptic only, no banner | **Unify**: shared, unit-testable cooldown/focus logic (pure function, ports `shouldPlayBellAlert` 1:1) driving platform-specific delivery (iOS: local notification + haptic; Web: title flash + beep + `Notification`) |
| Quick-keys bar (Esc/Tab/^C/^B/^D) | iOS only | Keep mobile-only (screen-size gated in shared code, not duplicated) |
| Poll intervals | session-creation 1000ms, changes 5000ms, env 3000ms — already consistent across both clients | Keep as-is, but test with `kotlinx-coroutines-test` virtual time instead of real delays |

## 3. Architecture

### 3.0 Confirmed dependency versions (research pass, July 2026 — do not rely on training-data defaults, this stack moves fast)
| Library | Version | Notes |
|---|---|---|
| Kotlin | **2.3.20** | Required minimum for Compose Multiplatform + Kotlin/Wasm; anything older breaks the wasmJs target |
| Compose Multiplatform | **1.11.1** (stable) | Web/Wasm target is still **Beta** within this release — accepted risk, not a defect |
| Ktor | **3.5.1** | Must be **≥3.2.3** regardless — KTOR-8700 (binary WS frames hang forever on wasmJs below this) |
| Ktor Client engine, iOS | `ktor-client-darwin` | NSURLSession-backed, full raw Frame.Text/Binary WS support |
| Ktor Client engine, Web | `ktor-client-js` | **Not** `ktor-client-cio` — CIO on wasmJs is Node-only and throws in-browser (KTOR-8192) |
| Navigation | `org.jetbrains.androidx.navigation:navigation-compose` **2.9.2** | Published for wasmJs since its first multiplatform release (`2.7.0-alpha03`); iOS is Stable, web platform itself is Beta (inherits from Compose Web being Beta), browser-history/URL integration is Experimental (`@ExperimentalBrowserHistoryApi`) — acceptable since we don't need deep-linking |

Fallback noted, not adopted by default: **Decompose** (`3.5.0`+) is the strongest actively-maintained alternative if `navigation-compose` causes real friction — confirmed wasmJs support since its `3.0.0`. **Voyager** is explicitly ruled out — maintainer-confirmed feature-frozen, and wasm URL routing (#468) has been open/unaddressed since Aug 2024.

### 3.1 Repo layout
New top-level directory `kmp/` (kept separate from the Node project root — no mixing of Gradle and npm tooling at the repo root):

```
kmp/
  settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml
  composeApp/
    src/commonMain/kotlin/...   # domain, data, presentation, ui — the vast majority of the code
    src/iosMain/kotlin/...      # actuals: token store, HTTP engine, terminal bridge, notifications
    src/wasmJsMain/kotlin/...   # actuals: token store, HTTP engine, terminal bridge (xterm.js interop), notifications
  iosApp/                       # thin Xcode project, SwiftUI shell hosting ComposeUIViewController
```

Scaffold this from the official Kotlin Multiplatform wizard (kmp.jetbrains.com "Compose Multiplatform: share UI" template) rather than hand-writing Gradle config from scratch — battle-tested defaults for target config, Kotlin/Gradle plugin versions, and Xcode integration. Per the research-first rule, also `gh search code`/`gh search repos` for existing examples of (a) SwiftTerm embedded in Compose Multiplatform iOS via UIKit interop, and (b) DOM-element interop (xterm.js or similar) inside Compose Multiplatform Web/Wasm, before hand-rolling either — this is genuinely novel-ish territory and worth checking what others have already solved.

### 3.2 Layering inside `commonMain` (Clean-ish, kept lightweight for a small/medium app)
- `data/remote/` — Ktor `HttpClient` API service + WebSocket connections (`TerminalConnection`, `LogsConnection` as `Flow`-based wrappers), DTOs + `kotlinx.serialization`.
- `data/local/` — `TokenStore` interface (expect/actual per platform, see 3.4).
- `domain/` — plain data classes (can reuse DTOs directly here — a translation layer between DTO and domain model is unwarranted duplication for this app's size) + repository interfaces + the handful of pieces of real logic worth unit-testing in isolation: bell cooldown, file-tree grouping, diff-line classification, session-name validation mirrors.
- `presentation/` — one `ViewModel` per screen: `StateFlow<UiState>` + a sealed `Intent`/event type. No use-case layer — repositories are thin enough that a use-case indirection would just be ceremony (YAGNI).
- `ui/` — Composables per screen + a small shared design-system (color tokens, type scale, spacing) matching the current dark, terminal-first look.
- `di/` — Koin modules (`commonModule`, `iosModule`, `wasmJsModule`).

Rationale for Koin over manual DI: it's the de facto standard for production KMP apps and directly serves the "teach me the standard architecture" goal; for an app this size a hand-rolled service locator would also work, but Koin is what the user will encounter in real KMP codebases.

### 3.3 Terminal embedding — the single biggest technical risk
xterm.js and SwiftTerm are both mature ANSI/VT100 terminal emulators; re-implementing one in Compose canvas is out of scope and not a reasonable ask for a small/medium app. Both platforms need a **native "hole" inside the shared Compose UI**:

- **iOS**: rather than Kotlin/Native cinterop against a Swift framework (brittle — Swift/Kotlin interop is easiest through `@objc`-visible NSObject subclasses, which SwiftTerm's `TerminalView` may or may not cleanly expose), use **inversion of control**: the Swift `iosApp` shell registers a native `UIView` factory closure into a small Kotlin-exposed provider *before* creating `ComposeUIViewController`. Shared code calls `UIKitView` interop against whatever `UIView` that factory returns. Kotlin never needs to know SwiftTerm exists.
- **Web**: Kotlin/Wasm has first-class JS interop (`external`, `@JsFun`), so shared/`wasmJsMain` code can drive `xterm.js` directly (construct `Terminal`, mount to a `<div>`, wire `onData`/`write`). The open question is positioning: overlay the DOM `div` absolutely, and sync its `left/top/width/height` from a Compose `Box`'s `onGloballyPositioned` callback on every layout pass — the same technique used for embedding video/iframe content in Compose Multiplatform Web samples.

**Research update (confirmed, not assumed):** no public project has embedded SwiftTerm inside Compose Multiplatform iOS, nor xterm.js inside Compose Multiplatform Web. The two closest real-world analogs — `soderbjorn/lunamux` and `UstaLabs/supermux`, both KMP terminal clients solving nearly this exact problem — deliberately kept terminal UI **100% native per platform** and shared only Kotlin business logic. That said, the mechanisms this plan calls for are official, JetBrains-documented APIs, not hacks:
- iOS: the IoC-factory pattern (§3.3 above) is exactly what JetBrains' own docs and Touchlab's `compose-swift-bridge` tooling codify (see e.g. `joreilly/PeopleInSpace`'s `NativeViewFactory`) — just never demonstrated for SwiftTerm specifically.
- Web: **`HtmlElementView`** (renamed from `WebElementView` in Compose Multiplatform 1.11.0, introduced 1.9.0) is the official "AndroidView/UIKitView-equivalent for Web" — designed exactly for overlaying a DOM element (its own docs example embeds an `<iframe>`) sized/positioned from Compose layout, no manual `onGloballyPositioned` math needed. One real constraint to design around: **CMP-8521** (open) — Compose UI cannot be drawn on top of an `HtmlElementView`, the DOM element always wins that rectangle. This is fine for our layout (EnvironmentBar/QuickKeysBar/LogsSheet are arranged around the terminal box, never overlaid on top of it), but the terminal composable must own a dedicated rectangle, not share one with floating Compose content.

**Decision (confirmed with user): this spike is a gate, with a pre-agreed fallback scoped to one screen, not an all-or-nothing bet.** Proceed with embedding SwiftTerm/xterm.js inside Compose Multiplatform per the above. If a spike genuinely fails (broken keyboard handling, unusable resize jank, DOM leaking outside its rect, etc.), the fallback is **native-only for the terminal screen alone** (a plain `UIViewController` push on iOS outside the Compose nav graph; a plain non-Compose DOM page on Web) — every other screen (project list, session list, changes, settings) stays one shared Compose Multiplatform codebase regardless of how the terminal spike goes. Record the outcome either way as an ADR.

### 3.4 Storage
Write a small custom `expect class TokenStore` / actuals rather than pulling in a settings library — the surface area is tiny (two values: token, base URL) and security parity matters exactly (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` on iOS, i.e. device-only, no iCloud sync — replicate exactly, don't approximate via a generic library default). iOS actual wraps `Security` framework directly (same approach as today's `KeychainStore.swift`, ported to Kotlin/Native cinterop against `Security.framework` — well-trodden). Web actual uses `localStorage`/`IndexedDB` via Kotlin/Wasm browser interop. Base URL is non-secret (mirrors today's `UserDefaults` split).

### 3.5 Networking
Ktor Client (multiplatform HTTP + WebSockets plugin), `kotlinx.serialization` for JSON. Darwin engine on iOS, JS engine on wasmJs.

### 3.6 Navigation
Confirmed: `androidx.navigation:navigation-compose` **2.9.2** (§3.0) — published for wasmJs since its first multiplatform release, so this is settled, not a Phase 0 open question anymore. We don't need browser deep-linking/URL routing (still Experimental on web), so that gap doesn't matter here. Record as an ADR for completeness, but no spike needed.

### 3.7 Testing strategy
- `kotlin.test` + `kotest-assertions-core` (both multiplatform) for all common-code tests.
- Ktor `MockEngine` for repository/API-client tests — direct Kotlin equivalent of today's `StubURLProtocol` pattern; **port the existing Swift test tables 1:1** (same fixtures, same edge cases) as the first RED tests.
- `kotlinx-coroutines-test` (`runTest`, virtual time) to test the poll-interval logic (session creation, changes, env status, bell cooldown) deterministically instead of with real delays.
- Turbine for asserting `StateFlow`/`Flow` emission sequences from ViewModels.
- Kover for multiplatform coverage reporting, gated at 80%+ per the global testing standard.
- Compose UI: automated UI-tree tests are limited on iOS/wasmJs targets today, so the primary automated layer is ViewModel/state-logic unit tests (this is where almost all the actual logic lives anyway); each screen gets a manual QA pass against the feature-parity checklist (§5) before being called done. This is a scope call, not an oversight — say so explicitly rather than claiming full UI automation that doesn't really exist yet for these targets.

## 4. Phases

### Phase 0 — Spike & de-risk (no production code)
- ~~Research~~ **done**: prior art + current docs for Ktor/Compose Multiplatform/Kotlin-Wasm/navigation confirmed via a multi-stream research pass (findings folded into §3.0/§3.3/§3.6 above) — do not re-derive from training-data recall, this stack moved fast enough that even Gradle itself is at 9.6.1.
- Scaffold the KMP project (`kmp/`), targets iosArm64/iosSimulatorArm64/wasmJs, pinned to the versions in §3.0.
- Spike A: minimal iOS terminal embed (IoC-factory pattern from §3.3) — prove keystrokes and PTY-echoed bytes round-trip through a fake WebSocket. **Verified via CI macOS runner**, not locally (this session runs on Linux; see Task #3).
- Spike B: minimal Web terminal embed (`HtmlElementView` + xterm.js via Kotlin/Wasm JS interop) — same round-trip proof, runnable locally on Linux. Fallback if too fragile: Compose HTML for the Web terminal screen only.
- Spike C: Ktor Client WebSocket (`ktor-client-js`/`ktor-client-darwin`, §3.0) against the **real, unmodified** Node server's `/ws` and `/ws/logs`, confirming exact wire-format parity (text frames, no JSON envelope on server→client for `/ws`). Runnable locally on Linux — the Node backend runs anywhere.
- ~~Spike D (navigation)~~ **resolved without a spike** — `navigation-compose` 2.9.2's wasmJs support is confirmed already published (§3.6).
- Output: ADRs for the two terminal-embedding decisions (`docs/adr/0001-ios-terminal-embedding.md`, `0002-web-terminal-embedding.md`) plus a short one for navigation (`0003-navigation.md`) even though no spike was needed for it.

### Phase 1 — Foundation
- Gradle multi-module setup (targets: iosArm64, iosSimulatorArm64, wasmJs), version catalog, ktlint/detekt.
- Wire Koin, kotlinx.serialization, Ktor Client (+WebSockets plugin), Kover.
- CI: extend/add a GitHub Actions workflow — `detekt`/`ktlint` job, `wasmJsTest` job (Linux runner, headless Chrome via Karma), iOS build+test job (macOS runner).

### Phase 2 — Shared domain & data layer (TDD)
- Port every model in §2.4 with kotlinx.serialization.
- Repository interfaces + Ktor implementations for: projects, sessions (incl. creation polling), changes/diff, env.
- `TerminalConnection`/`LogsConnection` Flow wrappers around the raw WebSocket protocol in §2.3.
- `TokenStore` (§3.4).
- **Port the existing Swift test tables first** (`APIClientTests`, `ClientMessageTests`, `EnvStatusTests`, `SessionCreationStatusTests`, `FileTreeTests`, `KeychainStoreTests`) as the initial RED suite using `MockEngine` — this is the concrete "write the test first" step for this rebuild, because the tests already exist and just need porting before the implementation does.

### Phase 3 — Presentation layer (TDD)
- ViewModels: `ProjectListViewModel`, `SessionListViewModel`, `TerminalViewModel` (owns PTY IO + resize/scroll + bell cooldown), `ChangesViewModel`, `EnvironmentViewModel`, `ConnectionSettingsViewModel`.
- Unit-test state transitions (loading/success/error, poll-driven updates) with fake repositories, `runTest` virtual time, and Turbine — AAA structure, descriptive names, per the global testing standard.

### Phase 4 — Shared Compose UI
- Design system (color/type/spacing tokens matching the current dark terminal aesthetic).
- Screens: project list + new-project sheet, session list + new-session sheet (with creation-progress polling UI), terminal screen (environment bar, quick-keys bar gated to mobile, logs sheet, embedded terminal from Phase 0's winning approach), changes sidebar (file tree + diff detail).
- Navigation per the Phase 0 decision.

### Phase 5 — Platform shells & integration
- `iosApp`: thin SwiftUI `App` hosting `ComposeUIViewController`, registers the native terminal-view factory (§3.3) at launch.
- Web entry: `index.html` + `ComposeViewport`, reusing the existing vendored `xterm.js`/`addon-fit.js` assets from `public/vendor/`.
- Full feature-parity pass against README's documented behaviors and `docs/testing/tmux-web.tdd.md`'s client-relevant user journeys (2,3,4,5,13,14,16–21), plus the gap-resolution decisions in §2.6.

### Phase 6 — Hardening, docs, cutover
- Regression pass: every REST/WS edge case from §2 exercised manually against a real backend instance (dirty-worktree force-delete, 409s, binary/untracked diffs, docker-compose-absent projects, etc.).
- Write `docs/architecture.md` (module diagram + data-flow, Mermaid), finalize ADRs, per-module READMEs, `docs/testing/tmux-web-kmp.tdd.md` mirroring the existing report's format and user-journey numbering.
- Update root `README.md`'s client setup sections.
- Cutover is a separate, explicitly-confirmed step: point `src/server.ts`'s static file serving at the new wasmJs build output, and decide whether `ios/TmuxWebClient` and `public/` are deleted outright or archived (e.g. `legacy/`) for one release cycle before deletion — **do not delete either without checking in first**, since they're the working reference implementation until the new client is verified end-to-end on a real device/browser.

## 5. Feature-parity checklist (must all be manually verified before cutover)
Derived from README + `docs/testing/tmux-web.tdd.md` + §2 above: token-gated REST+WS; project/session CRUD incl. 409 force-delete flows; live PTY attach/detach (tab close ≠ session death); resize on window/orientation change; tmux copy-mode scroll (unified per §2.6); bell alert (unified per §2.6); changes sidebar polling + diff view (staged/unstaged/untracked, binary handling); per-session docker-compose environment (setup/stop/logs/open-link) with correct opt-in invisibility for projects without `.tmux-web-env/`; session-creation progress polling.

## 6. Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| No public project has embedded SwiftTerm/xterm.js in Compose Multiplatform — this is genuinely untrodden, confirmed by research, not just "we didn't look hard enough" | Medium-High | Pre-agreed, screen-scoped fallback (native-only terminal screen, all else stays Compose) — decided *before* Phase 0 starts, not discovered mid-spike |
| `HtmlElementView`'s CMP-8521 (no Compose UI drawable atop it) forces a layout constraint | Low | Design terminal screen so the terminal owns a dedicated rectangle from the start; EnvironmentBar/QuickKeysBar/LogsSheet arranged around it, never overlaid |
| iOS native-view injection pattern has edge cases (rotation, VoiceOver focus, keyboard avoidance) | Medium | Spike covers the core round-trip only; budget hardening time in Phase 5; verified via CI macOS runner only (no local Mac in this session) |
| Compose Multiplatform Web/Wasm target is Beta (not Stable) as of CMP 1.11.1, mid-2026 — version churn risk | Medium | Pin exact versions in the catalog (§3.0); re-verify via fresh research before any mid-project upgrade, don't trust stale training data |
| Effort creep from "make it perfect" on a project whose explicit purpose includes learning | Low-Medium | Phases are ordered so a working, tested vertical slice (one screen end-to-end) exists early, before polishing all screens |
| Feature-parity gaps (§2.6) get silently resolved differently than expected | Low | Decisions are recorded explicitly above, not left implicit |

## 7. Acceptance
- [ ] All Phase 0 spikes resolved with recorded ADRs before Phase 1 starts.
- [ ] Every model/protocol edge case in §2 has a passing ported test.
- [ ] 80%+ Kover coverage on `commonMain` (domain/data/presentation).
- [ ] Feature-parity checklist (§5) manually verified on both a real iOS device/simulator and a real browser against a running backend.
- [ ] `docs/architecture.md`, ADRs, per-module READMEs, and `docs/testing/tmux-web-kmp.tdd.md` all exist and are accurate.
- [ ] Cutover step explicitly confirmed before old clients are removed.

## 8. Estimated complexity
Large overall. Phase 0 (spikes): Medium, highest-uncertainty phase despite being "small" in code volume. Phases 1–3: Medium each, low uncertainty (well-trodden KMP data/domain/presentation patterns). Phase 4–5: Large (most screens, plus the two platform integrations). Phase 6: Medium (mostly verification + writing).

---
**WAITING FOR CONFIRMATION**: proceed with this plan? (yes / modify: ... / different approach: ...)
