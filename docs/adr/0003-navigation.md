# ADR 0003: Navigation — official Navigation Compose Multiplatform

## Status
**Superseded** by [ADR 0004](0004-solidjs-pwa-migration.md) — `kmp/` was
deleted in Phase 10 of the web rebuild once the SolidJS PWA reached full
feature parity. The PWA uses `@solidjs/router` (see `web/src/App.tsx`) --
the equivalent official routing library for its own framework, playing the
same structural role `navigation-compose` played here, just on the new
stack. Kept here as historical record of the Compose-specific evaluation.

Originally: Accepted. No spike needed — resolved directly from research.

## Context
The plan's original Phase 0 scope included a spike to confirm whether
`androidx.navigation:navigation-compose` (the official JetBrains navigation
library) supports the `wasmJs` target well enough to use, with a documented
fallback to a hand-rolled `StateFlow<List<Screen>>` back stack if not (in
keeping with this repo's own stated philosophy of minimizing dependency count
for auditability — see the root README).

## Decision
Use `org.jetbrains.androidx.navigation:navigation-compose` **2.9.2**.

Research (cross-checked against live Maven Central metadata, not memory)
found `navigation-compose-wasm-js` has been a **published multiplatform
artifact since the library's very first multiplatform release**
(`2.7.0-alpha03`), through the current stable `2.9.2`. This settled the
question outright — no spike was needed.

## Nuance worth recording (not full-stable, but sufficient here)
"Stable" needs three separate claims, not one:
1. **The library API itself (Nav2 line)**: Stable, and iOS is Stable too.
2. **The Web/Wasm platform it runs on**: only **Beta** (Compose Multiplatform
   for Web went Beta in 1.9.0, Sept 2025; still Beta as of 1.11.1, mid-2026).
   This is a Compose-for-Web-wide caveat, not specific to navigation.
3. **Browser history/URL integration**
   (`NavController.bindToBrowserNavigation()`): gated behind
   `@ExperimentalBrowserHistoryApi`.

This project doesn't need (3) — there's no requirement for deep-linkable URLs
or browser back/forward integration in a self-hosted tmux session manager —
so the Experimental gap is irrelevant here. (2) is an accepted risk already
covered by ADR 0002's acknowledgment that the whole Web target is Beta.

## Alternatives considered
- **Decompose** (`com.arkivanov.decompose`): confirmed wasmJs support since
  its own `3.0.0`, very actively maintained (latest stable 3.5.0, a 3.6.0-alpha
  released ~2 weeks before this research). The strongest alternative if the
  official library causes real friction later — noted here so a future
  migration isn't a cold start, not adopted now (YAGNI: the official library
  already meets every requirement this app has).
- **Voyager** (`cafe.adriel.voyager`): explicitly **ruled out**. It compiles
  for wasmJs, but the maintainer confirmed (GitHub issue #556, open) it's in
  feature-frozen "keep current" mode, not active development, and wasm URL
  routing (#468) has been open and unaddressed since August 2024. Not a good
  bet for a new 2026 web-targeting project even though this project doesn't
  need URL routing today — a frozen library is the wrong foundation either way.

## Consequences
- One dependency, one well-trodden API, matches what the user will encounter
  in real-world production KMP codebases (the explicit learning goal behind
  this rebuild).
- If Decompose or another library is ever needed, the navigation surface is
  small (a handful of screens per the plan's Phase 4) — migration cost is low.
