import UIKit
import SwiftTerm
import ComposeApp

// Phase 0 Spike A implementation: wraps SwiftTerm.TerminalView so shared Kotlin
// code can embed it via UIKitView + TerminalViewProvider (see
// composeApp/src/iosMain/kotlin/.../terminal/TerminalViewFactory.kt for the
// Kotlin side of this contract, and docs/adr/0001-ios-terminal-embedding.md).
//
// Verified against the real ComposeApp.framework generated header (Kotlin
// 2.3.20 / Compose Multiplatform 1.11.1): the Kotlin interfaces carry an
// explicit swift_name of `TerminalViewFactory`/`TerminalViewHandle` — no
// `Protocol` suffix, unlike the default Kotlin/Native Obj-C export
// convention assumed when this file was first written. `Int` does bridge to
// `Int32` as expected (see `resize(cols:rows:)` below).
final class TerminalViewWrapper: TerminalView, TerminalViewHandle, TerminalViewDelegate {
    private let onInputCallback: (String) -> Void
    private let onBellCallback: () -> Void
    // Kotlin (Int, Int) -> Unit bridges to (KotlinInt, KotlinInt) -> Void in
    // Swift closure position — boxed, unlike the plain Int32 a direct method
    // parameter like resize(cols:rows:) above bridges to.
    private let onResizeCallback: (KotlinInt, KotlinInt) -> Void
    // Kotlin (String, Int) -> Unit; String bridges directly, Int still boxes
    // per the same rule as onResizeCallback above.
    private let onScrollCallback: (String, KotlinInt) -> Void
    private var scrollLineAccumulator: Double = 0
    private var lastPanTranslationY: CGFloat = 0

    init(
        onInput: @escaping (String) -> Void,
        onBell: @escaping () -> Void,
        onResize: @escaping (KotlinInt, KotlinInt) -> Void,
        onScroll: @escaping (String, KotlinInt) -> Void
    ) {
        self.onInputCallback = onInput
        self.onBellCallback = onBell
        self.onResizeCallback = onResize
        self.onScrollCallback = onScroll
        super.init(frame: .zero)
        self.terminalDelegate = self
        // Adds an observer target to SwiftTerm's OWN scroll gesture
        // recognizer (TerminalView subclasses UIScrollView, see
        // docs/adr/0001-ios-terminal-embedding.md) rather than attaching a
        // competing UIPanGestureRecognizer or overriding `contentOffset`:
        // both of those risk fighting SwiftTerm's own native scroll/render
        // handling in ways that can't be confirmed without a real
        // device/Xcode build, which this Linux-only dev environment can't
        // produce (see the file-level comment above). Adding a target to the
        // EXISTING recognizer only *reads* translation(in:) -- it never
        // mutates gesture or scroll-view state -- so SwiftTerm's own
        // scrolling keeps working exactly as it did before this change; this
        // purely layers tmux copy-mode reporting on top of it (see
        // handleScrollPan below for why the two aren't fully unified).
        // UIScrollView.panGestureRecognizer already accepts indirect
        // trackpad input on iPadOS in addition to touch, so no separate
        // trackpad-specific wiring is needed here.
        self.panGestureRecognizer.addTarget(self, action: #selector(handleScrollPan(_:)))
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    // MARK: TerminalViewHandle (Kotlin calls these to push PTY bytes)

    func write(data: String) {
        let bytes = Array(data.utf8)
        feed(byteArray: bytes[...])
    }

    func resize(cols: Int32, rows: Int32) {
        // Confirmed against SwiftTerm 1.2.4's real API (resolved via
        // xcodegen's SPM package): getTerminal().resize(cols:rows:) followed
        // by a layout pass, mirroring TerminalSocket.swift's sizeChanged
        // delegate callback in the existing (pre-KMP) iOS app.
        getTerminal().resize(cols: Int(cols), rows: Int(rows))
        setNeedsLayout()
    }

    // MARK: TerminalViewDelegate (SwiftTerm calls these; we forward to Kotlin)

    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        onInputCallback(String(decoding: data, as: UTF8.self))
    }

    func bell(source: TerminalView) {
        onBellCallback()
    }

    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        onResizeCallback(KotlinInt(int: Int32(newCols)), KotlinInt(int: Int32(newRows)))
    }

    // Required by TerminalViewDelegate — no-ops. `scrolled(source:position:)`
    // in particular is NOT wired to onScrollCallback: it reports a
    // normalized 0...1 position within SwiftTerm's own LOCAL scrollback
    // buffer (`terminal.buffer.yDisp`), which native touch/trackpad
    // scrolling on iOS never actually drives (confirmed by reading SwiftTerm
    // 1.2.4's iOSTerminalView.swift/AppleTerminalView.swift: iOS renders
    // straight from `dirtyRect`/`contentOffset`, bypassing `yDisp`
    // entirely) — using it here would silently never fire. Real
    // implementations for the rest of these (title updates, cwd tracking,
    // link opening) are out of this rebuild's scope (see plan §2.6 for the
    // ones that were deliberate scope calls, not oversights).
    func scrolled(source: TerminalView, position: Double) {}
    func setTerminalTitle(source: TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {}
    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}

    // MARK: Scroll -> tmux copy-mode
    //
    // Reports pan-gesture deltas (touch AND trackpad -- iPadOS routes both
    // through the same UIScrollView.panGestureRecognizer) as tmux copy-mode
    // scroll commands (see TerminalViewFactory.kt's onScroll kdoc for why:
    // tmux repaints a pane by cursor-addressing rather than appending lines,
    // so SwiftTerm's own local scrollback isn't a reliable substitute — same
    // reason the web build drives scroll through tmux copy-mode instead of
    // xterm.js's own scrollback). This intentionally does NOT suppress
    // SwiftTerm's own scroll rendering; both run side by side, since fully
    // replacing it (e.g. by overriding `contentOffset`) can't be confirmed
    // safe without a real build/device in this Linux-only dev environment —
    // if the resulting double-scroll feels wrong once tested on a real
    // iPad/trackpad, that's the next thing to revisit.
    @objc private func handleScrollPan(_ gesture: UIPanGestureRecognizer) {
        switch gesture.state {
        case .began:
            lastPanTranslationY = 0
            scrollLineAccumulator = 0
        case .changed:
            let translationY = gesture.translation(in: self).y
            let deltaY = translationY - lastPanTranslationY
            lastPanTranslationY = translationY
            // Dragging/swiping up moves translation.y negative, which is the
            // "scroll further down through the content" direction (same
            // sense as scrolling down a normal iOS list) -- negate so a
            // positive deltaY here means "down", matching the sign
            // convention already used by the web build's own
            // wheelEventToLines (public/app.js, pre-KMP). NOT verified live
            // (no device/simulator available here) -- if scrolling feels
            // inverted when actually tested, flip this negation.
            reportScroll(deltaY: -deltaY)
        default:
            break
        }
    }

    // Approximates SwiftTerm's per-line pixel height from bounds/rows, since
    // its real cell-height property (`cellDimension`) is `internal`, not
    // `public` -- not accessible from this file. Good enough once the
    // terminal has been fitted at least once (bounds.height > 0).
    private func reportScroll(deltaY: CGFloat) {
        guard deltaY != 0, bounds.height > 0 else { return }
        let rows = max(getTerminal().rows, 1)
        let pixelsPerLine = bounds.height / CGFloat(rows)
        guard pixelsPerLine > 0 else { return }
        scrollLineAccumulator += Double(deltaY / pixelsPerLine)
        let lines = Int(scrollLineAccumulator)
        guard lines != 0 else { return }
        scrollLineAccumulator -= Double(lines)
        onScrollCallback(lines < 0 ? "up" : "down", KotlinInt(int: Int32(abs(lines))))
    }
}

final class SwiftTermViewFactory: NSObject, TerminalViewFactory {
    func createTerminalView(
        onInput: @escaping (String) -> Void,
        onBell: @escaping () -> Void,
        onResize: @escaping (KotlinInt, KotlinInt) -> Void,
        onScroll: @escaping (String, KotlinInt) -> Void
    ) -> UIView {
        TerminalViewWrapper(onInput: onInput, onBell: onBell, onResize: onResize, onScroll: onScroll)
    }
}
