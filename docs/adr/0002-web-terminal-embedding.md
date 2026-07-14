# ADR 0002: Web terminal embedding — xterm.js via HtmlElementView

## Status
Accepted. Verified end-to-end on this (Linux) dev machine, including a real
headless-Chrome round trip of simulated keyboard input.

## Context
Same problem as ADR 0001 (re-implementing an ANSI/VT100 emulator in Compose
canvas is out of scope), but on the Web target. Compose Multiplatform for Web
has two distinct flavors: **Compose HTML** (`org.jetbrains.compose.web.dom`,
DOM-based, long-standing) and **Compose Multiplatform UI on `wasmJs`**
(Skia/canvas-rendered, the same renderer as iOS/Android/Desktop, the one this
project uses for maximum code-sharing per the plan). xterm.js is a DOM
library; the Skia/canvas renderer has no DOM to attach it to by default.

Research found **no public project embedding xterm.js in Compose Multiplatform
Web** either — the same gap as SwiftTerm on iOS (ADR 0001). But research also
found the mechanism needed: **`HtmlElementView`** (renamed from
`WebElementView` in Compose Multiplatform 1.11.0, introduced in 1.9.0) is an
official, JetBrains-documented composable — the Web equivalent of
`AndroidView`/`UIKitView` — that overlays a real DOM element on top of the
Compose canvas, sized and positioned automatically from Compose layout. Its
own docs example embeds an `<iframe>`; embedding a `<div>` that xterm.js
manages is the same mechanism, just a different DOM payload.

One real constraint surfaced by research: **CMP-8521** (open JetBrains issue)
— Compose UI cannot be drawn *on top of* an `HtmlElementView`; the embedded
DOM element always wins that rectangle, and input inside it goes to the DOM,
not Compose. This is a layout constraint to design around, not a blocker: the
terminal already needs to own a dedicated rectangle (EnvironmentBar,
QuickKeysBar, LogsSheet are arranged *around* it in the existing apps, never
overlaid on top of it).

## Decision
- Use `androidx.compose.ui.viewinterop.HtmlElementView<HTMLDivElement>` to
  create and position a container `<div>`.
- Load `xterm.js`/`addon-fit.js` as plain global `<script>` tags in
  `index.html` (the same vendored UMD-bundle assets already used by
  `public/vendor/`, not converted to npm/ES-module imports) — the bundle
  assigns `Terminal`/`FitAddon` onto `globalThis`, so Kotlin/Wasm's `external`
  declarations resolve against them directly with zero webpack/npm wiring.
  This was a deliberate simplification over `@JsModule`-based ES-module
  interop: it reuses an asset this repo already ships and avoids the thinner,
  more experimental npm-through-Kotlin/Wasm toolchain path research flagged.
- `composeApp/src/wasmJsMain/kotlin/.../terminal/XtermJs.kt` declares the
  minimal `external class XtermTerminal`/`XtermFitAddon` surface needed
  (`open`, `write`, `onData`, `onBell`, `resize`, `loadAddon`), gated behind
  `@OptIn(ExperimentalWasmJsInterop::class)` (Kotlin/Wasm JS interop is itself
  an experimental API surface as of Kotlin 2.3.20).
- `PlatformTerminalView.wasmJs.kt` (the `actual` for the same `expect` as ADR
  0001's iOS side) wires `HtmlElementView`'s `update` callback to construct the
  terminal once, load the fit addon, and forward `onData`/`onBell` to the
  shared callbacks.

## What was actually verified (and how)
Not just "it compiles" — a full behavioral check, run twice (once before and
once after refactoring the spike into the shared `PlatformTerminalView` API,
to make sure the refactor didn't silently break it):
1. `./gradlew :composeApp:wasmJsBrowserDevelopmentExecutableDistribution` —
   production-shaped bundle builds clean.
2. Served the output with a plain static file server, loaded it in a real
   headless Chrome (Puppeteer, `--no-sandbox` — this sandboxed dev environment
   needed that flag; see the "environment quirks" note below) instance.
3. Confirmed **zero JS page errors** and that `.xterm-screen` rendered inside
   the `HtmlElementView`-managed `<div>` with real, non-zero layout dimensions
   matching the Compose `Box` (704×432px in the test run) — proof
   `HtmlElementView` actually positioned the DOM element correctly, not just
   that it exists somewhere in the document.
4. Simulated real keyboard events typing `"hi"` via Puppeteer and confirmed
   the text appeared inside `.xterm-rows` — proof of the **full round trip**:
   Compose Wasm canvas → `HtmlElementView` → xterm.js DOM → browser keyboard
   event → xterm.js's `onData` → the Kotlin callback → local echo `write()` →
   back into xterm.js → rendered.

## Environment quirks discovered along the way (worth keeping on record)
- **Kotlin/Wasm's incremental compiler produced a genuine internal compiler
  error** (`ArrayIndexOutOfBoundsException` in `WasmIrFileMetadata`) after a
  *prior, real* type error was fixed — the ICE was **incremental-cache
  corruption, not a bug in the terminal-embedding code itself**: a
  `--rerun-tasks` (or equivalent clean build) resolved it immediately, and the
  same code then compiled cleanly on normal incremental builds afterward.
  Worth remembering for the rest of the project: if `compileKotlinWasmJs`
  throws a mysterious ICE right after fixing a real compile error, try a full
  rebuild before assuming new code is broken.
- Headless Chrome needs `--no-sandbox` (via a `karma.config.d/` override,
  `composeApp/karma.config.d/no-sandbox.js`) in this sandboxed/containerized
  dev environment — likely needed on the CI runner too, so it's committed to
  source control rather than left as a local-only workaround.

## Fallback (documented in advance, not reached)
If `HtmlElementView` had proven too fragile, the pre-agreed fallback was
**Compose HTML** (the DOM-based Compose flavor) for the Web terminal screen
only, trading a small amount of code-sharing with iOS on that one screen for
an easier DOM story. Not needed — the spike succeeded outright.

## Consequences
- `composeApp/src/wasmJsMain/resources/vendor/` now carries a duplicate copy
  of `xterm.js`/`xterm.css`/`addon-fit.js` from `public/vendor/` — acceptable
  during the rebuild (the old and new clients coexist until cutover, per the
  plan's Phase 6), but a candidate for deduplication once `public/` is
  retired.
- CMP-8521 means the terminal `Box` must stay a dedicated rectangle in the
  Phase 4 screen layout — no floating Compose overlays (tooltips, menus) drawn
  directly on top of it; anything like that needs to live outside the
  `HtmlElementView`'s bounds.
