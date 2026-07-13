import Foundation

/// Mirrors `EnvPhase` in ../../src/session-env.ts
enum EnvPhase: String, Codable {
    case unavailable, idle, starting, running, error, stopping
}

/// Mirrors `ComposeServiceStatus` in ../../src/docker-compose.ts
struct ComposeServiceStatus: Codable, Hashable {
    let service: String
    let state: String
    let health: String?
}

/// Mirrors `EnvStatus` in ../../src/session-env.ts
struct EnvStatus: Codable {
    let phase: EnvPhase
    let openUrl: String?
    let message: String?
    let services: [ComposeServiceStatus]?
}
