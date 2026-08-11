# ADR 0004: Replace the Kotlin Multiplatform client with a SolidJS + Vite PWA

## Status
Accepted and executed. `kmp/` (both its wasmJs web target and its native
iOS SwiftUI app) has been deleted. `web/` is now the only client; the
backend (`src/`) is unchanged, per its standing frozen-contract rule.

## Context
`kmp/` (ADRs [0001](0001-ios-terminal-embedding.md),
[0002](0002-web-terminal-embedding.md),
[0003](0003-navigation.md)) was a Kotlin Multiplatform + Compose
Multiplatform client targeting web (wasmJs) and native iOS from one
codebase, chosen for maximum code-sharing between the two platforms. It
worked, but the DOM-interop layer it needed for the terminal (xterm.js,
via `HtmlElementView`, ADR 0002) kept surfacing bugs that were invisible to
the Kotlin/Gradle toolchain and only reproduced live in a real browser:

- The `instanceof XtermTerminal` JS-interop naming mismatch.
- The `fitAddon.fit()` 0x0 layout race (container measured before the
  browser's own layout pass settled).
- A silently-dropped resize-before-WebSocket-open bug.
- Most seriously: `HtmlElementView`-embedded xterm.js either painting over,
  or — in the incident that prompted this repo's CLAUDE.md live-verification
  mandate — potentially still capturing focus/clicks meant for a Compose
  `Popup`/`Dialog` drawn on top of it (`CMP-8521`, noted in ADR 0002). A
  `RenameWindowDialog` change that shipped on `./gradlew build` passing
  alone left the app completely stuck — unable to type or click anything,
  requiring a page refresh to recover — the first time a real user hit it.

None of these were architecture-specific mistakes; they were the
structural cost of embedding a DOM library inside a canvas-rendered UI
framework via an interop boundary (ADR 0002's own "Environment quirks" and
"Consequences" sections document several of them directly). Every one of
them would not exist in a UI framework that renders to the DOM natively,
since the terminal wouldn't need an interop boundary to sit inside at all.

Separately, the project's actual highest-value target platform is iOS —
installed to the home screen via Safari, not distributed through the App
Store (this repo has no Apple Developer account and no interest in one).
A PWA achieves that installability without a native app at all, making
`kmp/`'s iOS SwiftUI target (ADR 0001) redundant on top of everything else.

## Decision
Rebuild the web client from scratch as a hand-written **SolidJS + Vite**
PWA under `web/`, port every `kmp/` feature to full parity, verify the
whole thing live, and only then delete `kmp/` entirely — never a partial
cutover with both clients coexisting past that point (an explicit,
deliberate project-owner decision: "sekaligus — full parity", not an
incremental rollout).

Why SolidJS specifically: fine-grained reactivity with no virtual DOM
(components run once, not on every state change — closer to Compose's own
recomposition-avoidance goals than React's re-render-then-diff model,
which made the mental model migration from `StateFlow`/`ViewModel` more
direct), a small runtime, and first-class TypeScript. `@xterm/xterm` is a
real DOM library rendering into a real `<div>` — no interop layer, no
`HtmlElementView`, no CMP-8521-shaped constraint, ever.

Structural mapping from the Kotlin architecture to the new one:

| Kotlin (`kmp/`) | SolidJS (`web/`) |
|---|---|
| `ViewModel` + `MutableStateFlow` | `createXStore(deps)` factory returning `{ state, ...methods }`, `state` backed by `solid-js/store` |
| `expect`/`actual` platform abstraction | plain injected-dependency params (e.g. `isSecureContext?: () => boolean`), defaulting to the real browser API |
| `HtmlElementView` + `XtermJs.kt` external interop | `@xterm/xterm` imported directly, driven from a real `<div ref>` (`web/src/terminal/TerminalView.tsx`) |
| `navigation-compose` (ADR 0003) | `@solidjs/router` |
| Koin DI | constructor-injected `deps` objects per store, no DI container |
| `domain/*.kt` pure logic | `web/src/domain/*.ts`, ported 1:1 where the logic was already platform-agnostic (fuzzy search, bell-alert cooldown, terminal search/clipboard shortcut detection, etc.) |

## What was actually verified (and how)
Not just "it typechecks" — every UI-affecting change across all eleven
build phases was checked live, per this repo's CLAUDE.md mandate, using a
consistent harness built up over the course of the migration:

1. A standalone Node script imports the **real** `createServer()` from
   `src/server.ts` (never a mocked backend) with a hand-built
   `ServerDeps`-shaped in-memory stub, run via
   `node --experimental-strip-types`.
2. Real `playwright-core` + a cached Chromium binary drive the built `web/`
   bundle exactly as a real browser would — click, type, screenshot,
   assert on rendered DOM state, not just "no console errors."
3. Two genuine, non-obvious Playwright/Chromium platform constraints were
   found and worked around during this process, not guessed at:
   - Chromium hard-blocks real `PushManager.subscribe()` calls inside
     Playwright's default incognito-style `browser.newContext()` —
     switching to `chromium.launchPersistentContext()` with a real
     disk-backed profile fixed it, and incidentally proved this sandbox has
     genuine outbound network access to Google's FCM push service, so the
     push-notification toggle's live check exercised a fully real
     end-to-end subscription, not a mocked one.
   - Firing two chorded key events (e.g. Ctrl+A immediately followed by
     Ctrl+V) with zero delay between them is a synthetic-automation
     artifact that silently no-ops real paste handling; a realistic ~80ms
     gap between distinct key presses is required to get signal instead of
     phantom failures.
4. `jsdom` (the unit-test environment) cannot run real `@xterm/xterm` at
   all — `new Terminal().open(div)` throws `this._parentWindow.matchMedia
   is not a function` — so every terminal-hosting unit test injects a
   fake `TerminalLike`/`FitAddonLike`/`SearchAddonLike` instead (see
   `web/src/terminal/types.ts`); real xterm.js behavior is exclusively
   covered by the live-browser passes above, never by the Vitest suite.
5. The split-terminal-pane feature (`web/src/screens/SplitTerminalPane.tsx`)
   additionally verified two independent, live WebSocket connections
   (`pane=0`/`pane=1`) really are independent — typed input to one pane
   provably never reaches the other — using a real `ws` echo server wired
   onto the same stub's `upgrade` event, with server-side message logging
   used to definitively separate a real app bug from a cosmetic
   software-rendering artifact (`--use-angle=swiftshader-webgl`, this
   sandbox's headless Chromium has no GPU) that turned out to affect only
   the screenshot, never the actual client→server payload.

## Consequences
- `kmp/` (web + iOS) is deleted. `.claude/plans/rebuild-web-ios-kmp.plan.md`
  remains as the phase-by-phase historical record of how the migration was
  planned and executed.
- `.github/workflows/kmp-ci.yml` is deleted; `web-ci.yml` (typecheck + test
  + build on every push touching `web/**`) is the only CI gate for the
  client now, alongside the backend's own `ci.yml`.
- ADRs [0001](0001-ios-terminal-embedding.md),
  [0002](0002-web-terminal-embedding.md), and
  [0003](0003-navigation.md) are superseded by this one but kept in place
  as historical record — each links back here.
- `CLAUDE.md`'s live-verification mandate was generalized from
  Compose-specific language to framework-agnostic language; the underlying
  rule (toolchain-green is not sufficient evidence for a real-DOM UI
  change) did not change, only which framework it's phrased against.
- The Release workflow (`.github/workflows/release.yml`) already stopped
  building/shipping `kmp/`'s web target before this ADR (it started
  building and attaching this PWA's `web/dist` bundle instead, during the
  migration's Phase 9) — this ADR's deletion is the final step of a
  transition that had already been underway release-by-release, not a
  sudden cutover.
- No native iOS app exists anymore. iOS access is exclusively via this PWA
  installed to the home screen through Safari's "Add to Home Screen" —
  full-screen, offline-capable app shell (`web/public/sw.js`), Web Push for
  bell notifications, no App Store account or review process involved.
