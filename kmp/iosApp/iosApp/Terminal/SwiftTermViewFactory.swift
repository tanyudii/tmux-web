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

    init(
        onInput: @escaping (String) -> Void,
        onBell: @escaping () -> Void,
        onResize: @escaping (KotlinInt, KotlinInt) -> Void
    ) {
        self.onInputCallback = onInput
        self.onBellCallback = onBell
        self.onResizeCallback = onResize
        super.init(frame: .zero)
        self.terminalDelegate = self
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

    // Required by TerminalViewDelegate — no-ops; real implementations (title
    // updates, scroll-driven copy-mode, cwd tracking, link opening) are out
    // of this rebuild's scope (see plan §2.6 for the ones that were deliberate
    // scope calls, not oversights).
    func scrolled(source: TerminalView, position: Double) {}
    func setTerminalTitle(source: TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {}
    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}

final class SwiftTermViewFactory: NSObject, TerminalViewFactory {
    func createTerminalView(
        onInput: @escaping (String) -> Void,
        onBell: @escaping () -> Void,
        onResize: @escaping (KotlinInt, KotlinInt) -> Void
    ) -> UIView {
        TerminalViewWrapper(onInput: onInput, onBell: onBell, onResize: onResize)
    }
}
