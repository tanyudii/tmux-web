import UIKit
import SwiftTerm
import ComposeApp

// Phase 0 Spike A implementation: wraps SwiftTerm.TerminalView so shared Kotlin
// code can embed it via UIKitView + TerminalViewProvider (see
// composeApp/src/iosMain/kotlin/.../terminal/TerminalViewFactory.kt for the
// Kotlin side of this contract, and docs/adr/0001-ios-terminal-embedding.md).
//
// UNVERIFIED — written without a local Xcode toolchain (this dev environment is
// Linux only; see .github/workflows/kmp-ci.yml's `ios` job for where this
// actually gets compiled and checked for the first time). Things flagged below
// with "VERIFY ON CI" are the specific spots most likely to need a one-line fix
// once a real Kotlin/Native-generated Objective-C header exists to check against:
// - Kotlin `interface Foo` is exported as an Obj-C `@protocol FooProtocol`, so
//   Swift sees `FooProtocol`, not `Foo` — used correctly below, but the exact
//   name depends on the ComposeApp.framework's generated header.
// - Kotlin `Int` bridges to Swift `Int32`.
final class TerminalViewWrapper: TerminalView, TerminalViewHandleProtocol, TerminalViewDelegate {
    private let onInputCallback: (String) -> Void
    private let onBellCallback: () -> Void

    init(onInput: @escaping (String) -> Void, onBell: @escaping () -> Void) {
        self.onInputCallback = onInput
        self.onBellCallback = onBell
        super.init(frame: .zero)
        self.terminalDelegate = self
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    // MARK: TerminalViewHandleProtocol (Kotlin calls these to push PTY bytes)

    func write(data: String) {
        let bytes = Array(data.utf8)
        feed(byteArray: bytes[...])
    }

    func resize(cols: Int32, rows: Int32) {
        // VERIFY ON CI: confirm SwiftTerm's exact resize entry point — likely
        // `getTerminal().resize(cols:rows:)` followed by a layout pass, mirroring
        // how TerminalSocket.swift's sizeChanged delegate callback currently
        // triggers a resize in the existing (pre-KMP) iOS app.
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

    // Required by TerminalViewDelegate — no-ops for this spike; real
    // implementations (title updates, scroll-driven copy-mode, cwd tracking)
    // land in Phase 4/5, not Phase 0.
    func scrolled(source: TerminalView, position: Double) {}
    func setTerminalTitle(source: TerminalView, title: String) {}
    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
}

final class SwiftTermViewFactory: NSObject, TerminalViewFactoryProtocol {
    func createTerminalView(onInput: @escaping (String) -> Void, onBell: @escaping () -> Void) -> UIView {
        TerminalViewWrapper(onInput: onInput, onBell: onBell)
    }
}
