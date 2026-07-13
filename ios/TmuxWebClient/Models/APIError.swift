import Foundation

/// Mirrors the error shapes `server.ts` maps HTTP status codes to
/// (`sendMappedError` in ../../src/server.ts).
enum APIError: Error, LocalizedError {
    case unauthorized
    case notFound(message: String)
    case badRequest(message: String)
    /// 409 -- e.g. a session's worktree has uncommitted changes and the
    /// caller must confirm force-delete, or a project still has active
    /// sessions.
    case conflict(message: String, sessionCount: Int?)
    case server(status: Int, message: String)
    case transport(Error)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "Token tidak valid atau kedaluwarsa."
        case .notFound(let message), .badRequest(let message):
            return message
        case .conflict(let message, _):
            return message
        case .server(_, let message):
            return message
        case .transport(let error):
            return "Tidak bisa menghubungi server: \(error.localizedDescription)"
        case .decoding:
            return "Respons server tidak sesuai format yang diharapkan."
        }
    }
}

struct APIErrorBody: Codable {
    let error: String
    let sessionCount: Int?
}
