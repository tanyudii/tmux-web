import Foundation

/// Mirrors `SessionCreationPhase`/`SessionCreationStatus` in ../../src/project-sessions.ts
enum SessionCreationPhase: String, Codable {
    case creating, ready, error
}

/// Mirrors `SessionCreationStatus` in ../../src/project-sessions.ts
struct SessionCreationStatus: Codable {
    let phase: SessionCreationPhase
    let message: String?
    let session: ProjectSession?
}

/// The fast `202 Accepted` response `startProjectSessionCreation` returns
/// immediately, before the worktree/tmux work happens in the background --
/// mirrors `{ name, fullName }` in ../../src/project-sessions.ts.
struct PendingSessionCreation: Codable {
    let name: String
    let fullName: String
}
