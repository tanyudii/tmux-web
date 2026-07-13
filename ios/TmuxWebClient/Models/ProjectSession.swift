import Foundation

/// Mirrors `ProjectSession` in ../../src/project-sessions.ts
struct ProjectSession: Codable, Identifiable, Hashable {
    let name: String
    let fullName: String
    let windows: Int
    let attached: Bool

    var id: String { fullName }
}

struct SessionListResponse: Codable {
    let sessions: [ProjectSession]
}

struct NewSessionRequest: Codable {
    let name: String
}
