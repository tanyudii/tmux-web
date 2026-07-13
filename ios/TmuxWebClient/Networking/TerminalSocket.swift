import Foundation
import UIKit
import SwiftTerm

/// Everything needed to (re)open the `/ws` socket for one tmux session.
/// `sessionFullName` must be `ProjectSession.fullName` (the composite
/// `<projectId>__<slug>` name) -- see ../../src/main.ts's upgrade handler,
/// which resolves this straight into `tmux attach-session -t <fullName>`.
struct TerminalConnectionInfo: Equatable {
    let baseURL: URL
    let token: String
    let sessionFullName: String
}

/// Bridges SwiftTerm's `TerminalView` to tmux-web's `/ws` WebSocket,
/// following the exact same `TerminalView, TerminalViewDelegate` pattern
/// SwiftTerm's own `SshTerminalView` example uses -- just swapping the SSH
/// channel for `URLSessionWebSocketTask`. Output bytes are fed straight to
/// the terminal (matching ../../src/pty-bridge.ts, which streams raw PTY
/// bytes with no framing); user input/resize are the only messages that
/// get JSON-encoded, via ClientMessage.
final class TmuxTerminalView: TerminalView, TerminalViewDelegate {
    private var webSocketTask: URLSessionWebSocketTask?
    private var configuredInfo: TerminalConnectionInfo?
    private let urlSession: URLSession = .shared

    var onBell: (() -> Void)?
    var onTitleChange: ((String) -> Void)?
    /// `true` once the socket opens, `false` on close/error. Drives the
    /// "disconnected -- reconnecting" banner in TerminalScreen.swift.
    var onConnectionStateChange: ((Bool) -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        terminalDelegate = self
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        webSocketTask?.cancel(with: .goingAway, reason: nil)
    }

    func configure(_ info: TerminalConnectionInfo) {
        guard configuredInfo != info else { return }
        configuredInfo = info
        connect(info: info)
        DispatchQueue.main.async { [weak self] in
            _ = self?.becomeFirstResponder()
        }
    }

    /// Detaches without tearing down `configuredInfo`, so `reconnect()`
    /// (called when the app returns to foreground -- iOS suspends the
    /// socket while backgrounded, it does not keep it alive) re-attaches
    /// to the same session. This mirrors tmux-web's own model: closing the
    /// connection is exactly a `tmux detach`, the session and everything
    /// running inside it keep going server-side (see ../../README.md).
    func disconnect() {
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
    }

    func reconnect() {
        guard let info = configuredInfo else { return }
        connect(info: info)
    }

    private func connect(info: TerminalConnectionInfo) {
        webSocketTask?.cancel(with: .goingAway, reason: nil)

        guard var components = URLComponents(url: info.baseURL, resolvingAgainstBaseURL: false) else { return }
        components.scheme = (components.scheme == "https") ? "wss" : "ws"
        components.path = "/ws"
        components.queryItems = [
            URLQueryItem(name: "session", value: info.sessionFullName),
            URLQueryItem(name: "token", value: info.token),
        ]
        guard let url = components.url else { return }

        let task = urlSession.webSocketTask(with: url)
        webSocketTask = task
        task.resume()
        onConnectionStateChange?(true)
        receiveLoop(task: task)

        // Correct the server's default 80x24 (see DEFAULT_COLS/DEFAULT_ROWS
        // in ../../src/main.ts) to whatever size this view is actually
        // laid out at.
        let terminal = getTerminal()
        let cols = terminal.cols > 0 ? terminal.cols : 80
        let rows = terminal.rows > 0 ? terminal.rows : 24
        sendMessage(.resize(cols: cols, rows: rows))
    }

    private func receiveLoop(task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self, self.webSocketTask === task else { return }
            switch result {
            case .failure:
                self.onConnectionStateChange?(false)
            case .success(let message):
                switch message {
                case .data(let data):
                    self.feed(byteArray: Array(data)[...])
                case .string(let text):
                    self.feed(byteArray: Array(text.utf8)[...])
                @unknown default:
                    break
                }
                self.receiveLoop(task: task)
            }
        }
    }

    private func sendMessage(_ message: ClientMessage) {
        guard let data = try? message.encoded(), let text = String(data: data, encoding: .utf8) else { return }
        webSocketTask?.send(.string(text)) { _ in }
    }

    // MARK: - TerminalViewDelegate

    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        sendMessage(.resize(cols: newCols, rows: newRows))
    }

    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        sendMessage(.input(String(decoding: data, as: UTF8.self)))
    }

    func setTerminalTitle(source: TerminalView, title: String) {
        onTitleChange?(title)
    }

    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}

    func scrolled(source: TerminalView, position: Double) {}

    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
        guard let url = URL(string: link) else { return }
        UIApplication.shared.open(url)
    }

    /// tmux-web's browser UI listens for this exact signal to flash the tab
    /// and fire a desktop notification (see ../../public/notify.js) --
    /// Claude Code rings it for "needs permission" / "task finished". Here
    /// we surface it as haptic feedback plus a hook the SwiftUI layer can
    /// use for an in-app banner or local notification.
    func bell(source: TerminalView) {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
        onBell?()
    }

    func clipboardCopy(source: TerminalView, content: Data) {
        UIPasteboard.general.string = String(data: content, encoding: .utf8)
    }

    func clipboardRead(source: TerminalView) -> Data? {
        UIPasteboard.general.string?.data(using: .utf8)
    }

    func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}

    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}
