import Foundation

/// Wire protocol for the `/ws` socket, mirroring `ClientMessage` and
/// `parseClientMessage` in ../../src/pty-bridge.ts exactly:
///   { "type": "input", "data": string }
///   { "type": "resize", "cols": number, "rows": number }
///
/// The server never sends JSON back over this socket -- output is raw PTY
/// bytes fed straight to SwiftTerm (see TerminalSocket.swift). This type
/// only needs to encode, but is kept round-trippable for the unit tests
/// that mirror pty-bridge.test.ts's coverage of the server-side parser.
enum ClientMessage: Equatable {
    case input(String)
    case resize(cols: Int, rows: Int)

    private enum CodingKeys: String, CodingKey {
        case type, data, cols, rows
    }

    func encoded() throws -> Data {
        var payload: [String: Any] = [:]
        switch self {
        case .input(let data):
            payload["type"] = "input"
            payload["data"] = data
        case .resize(let cols, let rows):
            payload["type"] = "resize"
            payload["cols"] = cols
            payload["rows"] = rows
        }
        return try JSONSerialization.data(withJSONObject: payload)
    }

    /// Mirrors the validation `parseClientMessage` performs server-side:
    /// `resize` requires positive integer cols/rows, `input` requires a
    /// string `data` field. Used only by tests to assert the encoder
    /// output is accepted by the same rules the server enforces.
    static func decode(_ data: Data) -> ClientMessage? {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = object["type"] as? String
        else { return nil }

        switch type {
        case "input":
            guard let text = object["data"] as? String else { return nil }
            return .input(text)
        case "resize":
            guard
                let cols = object["cols"] as? Int, cols > 0,
                let rows = object["rows"] as? Int, rows > 0
            else { return nil }
            return .resize(cols: cols, rows: rows)
        default:
            return nil
        }
    }
}
