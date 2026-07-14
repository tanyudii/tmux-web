import Testing
import Foundation
@testable import TmuxWebClient

/// Mirrors the JSON shapes `getSessionCreationStatus` can return in
/// ../../src/project-sessions.ts -- one fixture per `SessionCreationPhase`,
/// plus the fast `{name, fullName}` response `startProjectSessionCreation`
/// returns immediately.
struct SessionCreationStatusTests {
    private let decoder = JSONDecoder()

    @Test
    func decodesCreatingWithoutMessage() throws {
        let status = try decoder.decode(SessionCreationStatus.self, from: Data(#"{"phase":"creating"}"#.utf8))
        #expect(status.phase == .creating)
        #expect(status.message == nil)
        #expect(status.session == nil)
    }

    @Test
    func decodesCreatingWithProgressMessage() throws {
        let status = try decoder.decode(
            SessionCreationStatus.self,
            from: Data(#"{"phase":"creating","message":"Fetching origin/main…"}"#.utf8)
        )
        #expect(status.phase == .creating)
        #expect(status.message == "Fetching origin/main…")
        #expect(status.session == nil)
    }

    @Test
    func decodesReadyWithSession() throws {
        let json = #"""
        {
          "phase": "ready",
          "session": {"name": "feature-x", "fullName": "proj1__feature-x", "windows": 1, "attached": false}
        }
        """#
        let status = try decoder.decode(SessionCreationStatus.self, from: Data(json.utf8))
        #expect(status.phase == .ready)
        #expect(status.session == ProjectSession(name: "feature-x", fullName: "proj1__feature-x", windows: 1, attached: false))
    }

    @Test
    func decodesError() throws {
        let status = try decoder.decode(
            SessionCreationStatus.self,
            from: Data(#"{"phase":"error","message":"branch already exists"}"#.utf8)
        )
        #expect(status.phase == .error)
        #expect(status.message == "branch already exists")
        #expect(status.session == nil)
    }

    @Test
    func decodesPendingSessionCreationResponse() throws {
        let pending = try decoder.decode(
            PendingSessionCreation.self,
            from: Data(#"{"name":"feature-x","fullName":"proj1__feature-x"}"#.utf8)
        )
        #expect(pending.name == "feature-x")
        #expect(pending.fullName == "proj1__feature-x")
    }
}
