import Foundation

/// Everything needed to open the `/ws/logs` socket for one session's
/// environment (see ../../src/log-stream.ts / ../../src/main.ts's upgrade
/// handler). `service` narrows the stream to one docker-compose service;
/// `nil` streams every service merged, matching the "All services" option
/// in ../../public/app.js's Logs modal.
struct LogsConnectionInfo: Equatable {
    let baseURL: URL
    let token: String
    let projectId: String
    let sessionName: String
    let service: String?
}

/// Read-only WebSocket client for `docker compose logs --follow`, streamed
/// by ../../src/log-stream.ts. Kept separate from any SwiftTerm/UIKit view
/// (unlike TmuxTerminalView, which fuses the terminal view and its `/ws`
/// socket into one class) because a log tail has nothing to write back --
/// no ClientMessage, no resize, no input -- so there's no delegate
/// callback surface that would justify fusing it with the view.
final class LogsSocket {
    private var webSocketTask: URLSessionWebSocketTask?
    private let urlSession: URLSession = .shared

    var onData: ((String) -> Void)?
    var onClose: (() -> Void)?

    func connect(_ info: LogsConnectionInfo) {
        disconnect()

        guard var components = URLComponents(url: info.baseURL, resolvingAgainstBaseURL: false) else { return }
        components.scheme = (components.scheme == "https") ? "wss" : "ws"
        components.path = "/ws/logs"
        var queryItems = [
            URLQueryItem(name: "project", value: info.projectId),
            URLQueryItem(name: "session", value: info.sessionName),
            URLQueryItem(name: "token", value: info.token),
        ]
        if let service = info.service {
            queryItems.append(URLQueryItem(name: "service", value: service))
        }
        components.queryItems = queryItems
        guard let url = components.url else { return }

        let task = urlSession.webSocketTask(with: url)
        webSocketTask = task
        task.resume()
        receiveLoop(task: task)
    }

    func disconnect() {
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
    }

    deinit {
        webSocketTask?.cancel(with: .goingAway, reason: nil)
    }

    private func receiveLoop(task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self, self.webSocketTask === task else { return }
            // `receive`'s completion fires on a background queue, but
            // `onData`/`onClose` ultimately feed a UIKit terminal view (see
            // LogsSheet.swift) -- same fix as TerminalSocket.swift's
            // receiveLoop for the identical "UI changes are not supported
            // off the main thread" crash.
            DispatchQueue.main.async {
                switch result {
                case .failure:
                    self.onClose?()
                case .success(let message):
                    switch message {
                    case .string(let text):
                        self.onData?(text)
                    case .data(let data):
                        self.onData?(String(decoding: data, as: UTF8.self))
                    @unknown default:
                        break
                    }
                    self.receiveLoop(task: task)
                }
            }
        }
    }
}
