import SwiftUI
import SwiftTerm

/// Lets the SwiftUI layer (TerminalContainerView) imperatively command the
/// underlying UIKit TmuxTerminalView -- reconnect on foreground, inject a
/// quick key -- without SwiftUI's declarative `updateUIView` diffing being
/// the only way in.
final class TerminalCoordinator {
    fileprivate weak var terminalView: TmuxTerminalView?

    func reconnect() { terminalView?.reconnect() }
    func disconnect() { terminalView?.disconnect() }
    func insertText(_ text: String) { terminalView?.insertText(text) }
}

struct TerminalRepresentable: UIViewRepresentable {
    let connectionInfo: TerminalConnectionInfo
    let coordinator: TerminalCoordinator
    let onBell: () -> Void
    let onTitleChange: (String) -> Void
    let onConnectionStateChange: (Bool) -> Void

    /// Resolves `Context.Coordinator` to `TerminalCoordinator` (instead of
    /// the protocol's default `Void`) so `dismantleUIView` below can
    /// receive it typed and call `disconnect()` -- we still hand the same
    /// externally-owned `coordinator` back rather than letting SwiftUI
    /// create one, since TerminalContainerView needs to hold a stable
    /// reference to call `reconnect()`/`insertText(_:)` on imperatively.
    func makeCoordinator() -> TerminalCoordinator {
        coordinator
    }

    func makeUIView(context: Context) -> TmuxTerminalView {
        let view = TmuxTerminalView(frame: .zero)
        view.onBell = onBell
        view.onTitleChange = onTitleChange
        view.onConnectionStateChange = onConnectionStateChange
        coordinator.terminalView = view
        view.configure(connectionInfo)
        return view
    }

    func updateUIView(_ uiView: TmuxTerminalView, context: Context) {
        uiView.configure(connectionInfo)
    }

    static func dismantleUIView(_ uiView: TmuxTerminalView, coordinator: TerminalCoordinator) {
        uiView.disconnect()
    }
}
