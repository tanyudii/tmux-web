# ADR 0001: iOS terminal embedding — SwiftTerm via inversion-of-control factory

## Status
Accepted (Phase 0 spike). Kotlin side compiled and verified on Linux; Swift
side and final linking are unverified until the CI macOS runner
(`.github/workflows/kmp-ci.yml`, `ios` job) builds this for the first time.

## Context
The client rebuild shares UI via Compose Multiplatform across iOS and Web, but
the terminal screen needs a real ANSI/VT100 emulator — re-implementing one in
Compose canvas is out of scope for a small/medium app (see
`.claude/plans/rebuild-web-ios-kmp.plan.md` §3.3). The existing iOS app already
uses SwiftTerm (`ios/TmuxWebClient`); reusing it is the obvious move, but
Kotlin/Native has no direct Swift interop — it only bridges through
Objective-C (`@objc`/`NSObject`-visible APIs), and SwiftTerm's public surface
(a Swift `protocol` delegate, `ArraySlice<UInt8>` parameters) is not
Objective-C-compatible as-is.

A background research pass (four parallel streams, folded into the plan)
found **no public project that embeds SwiftTerm inside Compose Multiplatform
iOS**. The two closest real-world analogs solving nearly this exact problem —
`soderbjorn/lunamux` and `UstaLabs/supermux`, both KMP clients for
terminal/agent backends — deliberately kept the iOS terminal screen **fully
native SwiftUI + SwiftTerm**, sharing only Kotlin business logic. That is a
meaningful signal, but the mechanism this ADR chooses (below) is not a hack —
it's exactly what JetBrains' own docs and Touchlab's `compose-swift-bridge`
tooling codify (e.g. `joreilly/PeopleInSpace`'s `NativeViewFactory` pattern);
it has simply never been pointed at SwiftTerm specifically.

## Decision
Use **inversion of control**, not direct cinterop:

1. `composeApp`'s `iosMain` declares two Kotlin interfaces —
   `TerminalViewFactory` (`createTerminalView(onInput, onBell): UIView`) and
   `TerminalViewHandle` (`write(data)`, `resize(cols, rows)`) — plus a settable
   singleton `TerminalViewProvider.factory`.
2. `iosApp` (Swift) implements `TerminalViewFactory`, returning a
   `TerminalViewWrapper: TerminalView, TerminalViewHandleProtocol,
   TerminalViewDelegate` — a class that **is** a `UIView` (SwiftTerm's
   `TerminalView` subclasses `UIScrollView` → `UIView` → `NSObject`, so it's
   already Objective-C-visible) and **also conforms** to the
   Kotlin-defined `TerminalViewHandle` protocol, so the same native object
   serves both roles.
3. `iOSApp.swift` sets `TerminalViewProvider.shared.factory =
   SwiftTermViewFactory()` in its `init()`, before `ContentView()` creates
   `MainViewController()`.
4. The shared `PlatformTerminalView` composable (`expect`/`actual`,
   `composeApp/src/commonMain/.../terminal/PlatformTerminalView.kt`) calls
   `UIKitView { factory.createTerminalView(...) }` on iOS, then casts the
   returned `UIView` to `TerminalViewHandle` to get a `write`/`resize` handle
   back onto the same object it just embedded.

Kotlin never references `SwiftTerm` — only the two interfaces it owns. Swift
never references Compose internals — only the two interfaces Kotlin exposes.

## What was actually verified (and how)
This dev environment is Linux-only, so **Xcode/linking cannot run here**. What
*could* be verified locally, and was:
- `./gradlew :composeApp:compileKotlinIosSimulatorArm64` — **succeeds**. This
  was an unplanned but valuable finding: Kotlin/Native's compiler frontend
  (source → klib) cross-compiles for `iosSimulatorArm64` on Linux even though
  final linking against Apple SDKs does not. This gave real compiler feedback
  on `TerminalViewFactory.kt`, `PlatformTerminalView.ios.kt`, and
  `MainViewController.kt` — expect/actual signatures matching, `UIKitView`
  usage, interface shapes — not just "written and hoped."
- `./gradlew :composeApp:linkDebugFrameworkIosSimulatorArm64` — **skipped**
  (Gradle correctly detects the host can't link Apple binaries and no-ops it,
  per `kotlin.native.ignoreDisabledTargets=true`). This step, and everything
  downstream of it (the actual `.framework`, the Swift side, XcodeGen project
  generation, `xcodebuild`), is **unverified** until CI runs.

## Known unverified specifics (flagged, not glossed over)
- **Protocol naming**: Kotlin `interface Foo` is expected to export as
  Objective-C `@protocol FooProtocol`, so the Swift code was written against
  `TerminalViewFactoryProtocol` / `TerminalViewHandleProtocol`. This is the
  standard Kotlin/Native convention, but it depends on the actual generated
  `ComposeApp.framework` header — a one-line rename if wrong.
  `SwiftTermViewFactory.swift` documents this explicitly at the point of use.
- **Kotlin `Int` → Swift `Int32`**: `resize(cols: Int32, rows: Int32)` in the
  Swift protocol conformance assumes this standard bridging; unverified.
  against a real generated header.
- **SwiftTerm's exact resize API shape**: `TerminalViewWrapper.resize` calls
  `getTerminal().resize(cols:rows:)` then `setNeedsLayout()` — a best guess
  from SwiftTerm's public source, flagged inline as "VERIFY ON CI."
- **Delegate stub completeness**: `TerminalViewDelegate` conformance includes
  no-op stubs for `scrolled`/`setTerminalTitle`/`sizeChanged`/
  `hostCurrentDirectoryUpdate` — correct methods to stub for Phase 0, but the
  real implementations (copy-mode scroll, title sync) are Phase 4/5 work per
  the plan, not this spike.

## Fallback (pre-agreed, not a mid-project surprise)
If CI reveals this pattern is fundamentally unworkable for SwiftTerm
specifically (not just "needs a naming fix"), the fallback — agreed with the
user *before* Phase 0 started — is scoped to one screen: make the terminal
screen alone a plain native `UIViewController` pushed outside the Compose nav
graph, while every other screen (project list, session list, changes,
settings) stays one shared Compose Multiplatform codebase. This is not an
all-or-nothing bet on Compose Multiplatform for the whole client.

## Consequences
- Kotlin's `iosMain` source set stays free of any SwiftTerm dependency —
  `SwiftTerm` is a Swift Package dependency of `iosApp` only
  (`kmp/iosApp/project.yml`), not of `composeApp`.
- Every future platform-native embedding need (not just the terminal) can
  reuse this exact IoC pattern.
- The real verification gate is the CI `ios` job — this ADR's "Accepted"
  status should be revisited (not silently assumed) once that job runs for
  the first time.
