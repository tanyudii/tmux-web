import Testing
import Foundation
@testable import TmuxWebClient

/// Mirrors the JSON shapes `getSessionEnvStatus` can return in
/// ../../src/session-env.ts -- one fixture per `EnvPhase`.
struct EnvStatusTests {
    private let decoder = JSONDecoder()

    @Test
    func decodesUnavailable() throws {
        let status = try decoder.decode(EnvStatus.self, from: Data(#"{"phase":"unavailable"}"#.utf8))
        #expect(status.phase == .unavailable)
        #expect(status.openUrl == nil)
        #expect(status.services == nil)
    }

    @Test
    func decodesIdle() throws {
        let status = try decoder.decode(EnvStatus.self, from: Data(#"{"phase":"idle"}"#.utf8))
        #expect(status.phase == .idle)
    }

    @Test
    func decodesStarting() throws {
        let status = try decoder.decode(
            EnvStatus.self,
            from: Data(#"{"phase":"starting","message":"Running pre-run.sh"}"#.utf8)
        )
        #expect(status.phase == .starting)
        #expect(status.message == "Running pre-run.sh")
    }

    @Test
    func decodesRunningWithOpenUrlAndServices() throws {
        let json = #"""
        {
          "phase": "running",
          "openUrl": "http://localhost:54321",
          "services": [{"service": "web", "state": "running", "health": "healthy"}]
        }
        """#
        let status = try decoder.decode(EnvStatus.self, from: Data(json.utf8))
        #expect(status.phase == .running)
        #expect(status.openUrl == "http://localhost:54321")
        #expect(status.services == [ComposeServiceStatus(service: "web", state: "running", health: "healthy")])
    }

    @Test
    func decodesError() throws {
        let status = try decoder.decode(
            EnvStatus.self,
            from: Data(#"{"phase":"error","message":"compose up failed"}"#.utf8)
        )
        #expect(status.phase == .error)
        #expect(status.message == "compose up failed")
    }

    @Test
    func decodesStopping() throws {
        let status = try decoder.decode(EnvStatus.self, from: Data(#"{"phase":"stopping"}"#.utf8))
        #expect(status.phase == .stopping)
    }
}
