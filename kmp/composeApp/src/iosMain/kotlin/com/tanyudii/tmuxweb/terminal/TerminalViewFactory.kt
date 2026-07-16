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
     * - call [onResize] when its own column/row count changes (from rotation,
     *   Slide Over, or an initial layout pass) so TerminalViewModel.onResize
     *   can send the server a `resize` message
     * - call [onScroll] for trackpad/touch scroll gestures (SwiftTerm's own
     *   local scrollback is unreliable for a tmux pane — same reason the web
     *   target drives scroll through tmux copy-mode instead of xterm.js's
     *   native scrollback — so the view must NOT let SwiftTerm apply the
     *   scroll to its own buffer; it only reports the delta here). [onScroll]'s
     *   direction crosses as a plain "up"/"down" string (the same vocabulary
     *   ClientMessage's own JSON wire encoding uses, see
     *   commonMain/.../ClientMessage.kt's parseScrollDirection) rather than
     *   the Kotlin ScrollDirection enum directly -- this file's own Obj-C
     *   export names can only be confirmed against a real build of
     *   ComposeApp.framework (see the file-level comment on
     *   SwiftTermViewFactory.swift), which isn't possible from this
     *   Linux-only dev environment. A String avoids depending on a
     *   Kotlin-enum-to-Obj-C bridged name that can't be verified here.
     */
    fun createTerminalView(
        onInput: (String) -> Unit,
        onBell: () -> Unit,
        onResize: (cols: Int, rows: Int) -> Unit,
        onScroll: (direction: String, lines: Int) -> Unit,
    ): UIView
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
