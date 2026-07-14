package com.tanyudii.tmuxweb.terminal

import platform.UIKit.UIView

// Phase 0 Spike A: inversion-of-control bridge to SwiftTerm, per the pattern
// confirmed by research (JetBrains' UIKitViewController docs, PeopleInSpace's
// NativeViewFactory, Touchlab's compose-swift-bridge) — Kotlin/Native has no
// direct Swift interop, so Kotlin never touches SwiftTerm directly. Instead:
// 1. Kotlin declares these protocol-like interfaces + a settable singleton.
// 2. iosApp (Swift) implements TerminalViewFactory wrapping SwiftTerm.TerminalView
//    in a class that is BOTH a UIView and conforms to TerminalViewHandle, and
//    sets TerminalViewProvider.factory before ComposeUIViewController is created.
// 3. PlatformTerminalView.ios.kt (actual) calls the factory via UIKitView, then
//    casts the returned UIView to TerminalViewHandle to get a write()/resize()
//    handle back onto the SAME native object it just embedded.
// See docs/adr/0001-ios-terminal-embedding.md — UNVERIFIED locally (no macOS in
// this dev environment; verification happens on the CI macOS runner, see
// .github/workflows/kmp-ci.yml).
interface TerminalViewFactory {
    /**
     * Must return a UIView that also conforms to [TerminalViewHandle] (Swift:
     * `class Foo: UIView, TerminalViewHandle`). The view must:
     * - render PTY output written via [TerminalViewHandle.write]
     * - call [onInput] for every byte the user types (mirrors ClientMessage's
     *   "input" case — see .claude/plans/rebuild-web-ios-kmp.plan.md §2.3)
     * - call [onBell] when the terminal receives BEL (0x07)
     */
    fun createTerminalView(onInput: (String) -> Unit, onBell: () -> Unit): UIView
}

/** Kotlin -> native direction: shared code calls this to push PTY bytes / resize. */
interface TerminalViewHandle {
    fun write(data: String)
    fun resize(cols: Int, rows: Int)
}

object TerminalViewProvider {
    // Set once by iosApp (Swift) at launch, before MainViewController() is called.
    // Not a lateinit var so a missing registration fails fast with a clear message
    // instead of a cryptic UninitializedPropertyAccessException deep in Compose.
    var factory: TerminalViewFactory? = null
}
