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
final class TerminalViewWrapper: TerminalView, TerminalViewHandle, TerminalViewDelegate, UIGestureRecognizerDelegate {
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
        // CONFIRMED against SwiftTerm 1.2.4 source
        // (Sources/SwiftTerm/iOS/iOSTerminalView.swift): this used to add a
        // target to SwiftTerm's OWN UIScrollView-inherited
        // `panGestureRecognizer`, but that recognizer loses a silent,
        // near-permanent tug-of-war against a SEPARATE one SwiftTerm installs
        // itself. tmux runs with `mouse on` (tmux.ts), so
        // `mouseModeChanged(source:)` calls `enableMousePanGesture()`, adding
        // its own independent `panMouseGesture` (a plain UIPanGestureRecognizer,
        // not the UIScrollView-special one) that forwards raw drag motion to
        // tmux as SGR mouse events -- entering tmux's copy-mode selection,
        // which auto-scrolls at pane edges as a real tmux feature. SwiftTerm
        // sets no `shouldRecognizeSimultaneously` between that recognizer and
        // `panGestureRecognizer`, so plain UIKit gesture arbitration lets only
        // one win per touch, and `panMouseGesture` almost always did --
        // starving this file's own scroll reporting almost entirely. What
        // looked like "scrolling" before this fix was actually tmux's own
        // edge auto-scroll, which is far more reachable when the on-screen
        // keyboard shrinks the terminal's visible height (touches land closer
        // to the edge) and far LESS reachable at full height with an external
        // keyboard attached (no on-screen keyboard ever shrinks it) -- which
        // is exactly the "can't scroll at all with a keyboard attached" bug
        // report this fixes.
        //
        // Fix: a dedicated UIPanGestureRecognizer, wired via
        // UIGestureRecognizerDelegate to always recognize simultaneously with
        // every other recognizer on this view (see
        // gestureRecognizer(_:shouldRecognizeSimultaneouslyWith:) below).
        // That decouples "does tmux copy-mode get a scroll report" from
        // "which recognizer iOS happened to pick as the winner for this
        // touch" entirely -- it now fires regardless of panMouseGesture (or
        // panSelectionGesture, or the inherited panGestureRecognizer) also
        // firing for the same touch.
        //
        // FOLLOW-UP, confirmed on a real iPad: an earlier version of this
        // fix left `cancelsTouchesInView` at its UIGestureRecognizer default
        // (true) and ALSO toggled `allowMouseReporting` off for the
        // duration of the gesture -- and that made scrolling stop working
        // ENTIRELY, in every condition, not just the keyboard-attached one
        // this file originally targeted. `cancelsTouchesInView = true`
        // means that the moment this recognizer starts recognizing (which,
        // having no competing requirements, is almost immediately on any
        // drag), it cancels raw touch delivery to the view underneath --
        // and TerminalView being a UIScrollView subclass, that raw touch
        // stream is what its OWN internal scroll machinery depends on, not
        // just its `panGestureRecognizer`'s recognized state.
        // `shouldRecognizeSimultaneouslyWith` only arbitrates
        // recognizer-vs-recognizer, not recognizer-vs-view, so it did
        // nothing to prevent this. `cancelsTouchesInView = false` below
        // makes this recognizer a pure observer -- it reports scroll deltas
        // without ever cancelling or delaying touch delivery to anything
        // else on this view. The `allowMouseReporting` toggle from that
        // earlier version is also removed entirely: SwiftTerm's own
        // panSelectionHandler sends actual cursor-key presses instead of
        // scrolling when allowMouseReporting is false and a selection pan
        // is mid-gesture (see its `.changed` case), which is a plausible
        // second contributor to the same regression -- there is no need to
        // touch that flag at all now that this recognizer no longer
        // competes for the touch stream itself.
        let scrollGesture = UIPanGestureRecognizer(target: self, action: #selector(handleScrollPan(_:)))
        scrollGesture.delegate = self
        scrollGesture.cancelsTouchesInView = false
        addGestureRecognizer(scrollGesture)
    }

    // Unconditionally true: this view has several other UIPanGestureRecognizers
    // (SwiftTerm's own panMouseGesture/panSelectionGesture/panGestureRecognizer),
    // and scroll reporting to tmux copy-mode must never depend on winning
    // arbitration against any of them -- see the long comment in init above.
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
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
    // through this dedicated, cancelsTouchesInView=false recognizer, see
    // init above) as tmux copy-mode scroll commands (see
    // TerminalViewFactory.kt's onScroll kdoc for why: tmux repaints a pane
    // by cursor-addressing rather than appending lines, so SwiftTerm's own
    // local scrollback isn't a reliable substitute — same reason the web
    // build drives scroll through tmux copy-mode instead of xterm.js's own
    // scrollback). This intentionally does NOT touch `allowMouseReporting`
    // or otherwise suppress SwiftTerm's own panMouseGesture/selection
    // handling -- both run side by side (see the FOLLOW-UP comment in init
    // for why an earlier version that DID toggle allowMouseReporting made
    // scrolling stop working entirely on a real device).
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
            // wheelEventToLines (public/app.js, pre-KMP).
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
