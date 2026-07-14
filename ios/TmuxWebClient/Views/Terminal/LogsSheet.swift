import SwiftUI
import SwiftTerm

/// Read-only terminal view for streaming `docker compose logs -f` output --
/// reuses SwiftTerm purely as an ANSI renderer, mirroring how
/// ../../../public/app.js's Logs modal reuses xterm.js the same way (see
/// ../../../README.md's "Logs dashboard" section). Every input-side
/// delegate callback is a no-op: a log tail has nothing to write back to,
/// matching the one-directional design of ../../../src/log-stream.ts's
/// `attachLogsToSocket` (no ClientMessage, no PTY on the other end).
final class LogsTerminalView: TerminalView, TerminalViewDelegate {
    override init(frame: CGRect) {
        super.init(frame: frame)
        terminalDelegate = self
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func write(_ text: String) {
        feed(byteArray: Array(text.utf8)[...])
    }

    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {}
    func send(source: TerminalView, data: ArraySlice<UInt8>) {}
    func setTerminalTitle(source: TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func scrolled(source: TerminalView, position: Double) {}
    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {}
    func clipboardCopy(source: TerminalView, content: Data) {}
    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}

/// Bridges LogsSheet to LogsTerminalView + LogsSocket, the same role
/// TerminalCoordinator plays for the main terminal (see
/// TerminalScreen.swift). The socket callbacks read `self?.terminalView`
/// at call time rather than closing over it once, so a view swapped in by
/// SwiftUI (e.g. `.id(service)` forcing a fresh, empty buffer on filter
/// change) is always the one that receives new data.
final class LogsTerminalCoordinator {
    fileprivate weak var terminalView: LogsTerminalView?
    private let socket = LogsSocket()

    init() {
        socket.onData = { [weak self] text in
            self?.terminalView?.write(text)
        }
        socket.onClose = { [weak self] in
            self?.terminalView?.write("\r\n\u{1B}[90m[log stream closed]\u{1B}[0m\r\n")
        }
    }

    func connect(_ info: LogsConnectionInfo) {
        socket.connect(info)
    }

    func disconnect() {
        socket.disconnect()
    }
}

struct LogsTerminalRepresentable: UIViewRepresentable {
    let coordinator: LogsTerminalCoordinator

    func makeUIView(context: Context) -> LogsTerminalView {
        let view = LogsTerminalView(frame: .zero)
        coordinator.terminalView = view
        return view
    }

    func updateUIView(_ uiView: LogsTerminalView, context: Context) {}
}

/// Logs dashboard for a session's environment -- streams merged or
/// per-service `docker compose logs -f` over `/ws/logs`. Mirrors
/// ../../../public/app.js's Logs modal (service picker + read-only
/// terminal); presented as a sheet from EnvironmentBar instead of a modal
/// overlay, which is the native iOS equivalent.
struct LogsSheet: View {
    let client: APIClient
    let projectId: String
    let sessionName: String
    let services: [ComposeServiceStatus]

    @State private var selectedService = ""
    @State private var coordinator = LogsTerminalCoordinator()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            LogsTerminalRepresentable(coordinator: coordinator)
                .id(selectedService)
                .navigationTitle("Logs")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        Picker("Service", selection: $selectedService) {
                            Text("All services").tag("")
                            ForEach(services, id: \.service) { service in
                                Text(service.service).tag(service.service)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") { dismiss() }
                    }
                }
                .onAppear { connect() }
                .onDisappear { coordinator.disconnect() }
                .onChange(of: selectedService) { _, _ in connect() }
        }
    }

    private func connect() {
        coordinator.connect(
            LogsConnectionInfo(
                baseURL: client.settings.baseURL,
                token: client.settings.token,
                projectId: projectId,
                sessionName: sessionName,
                service: selectedService.isEmpty ? nil : selectedService
            )
        )
    }
}
