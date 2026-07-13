import Testing
import Foundation
@testable import TmuxWebClient

/// Mirrors the status-code-mapping behavior asserted server-side in
/// ../../src/server.test.ts (`sendMappedError`), but from the client's
/// point of view: does APIClient turn each HTTP status into the right
/// APIError case?
///
/// `.serialized`: StubURLProtocol's stub table is static (URLProtocol's
/// class-based loading system leaves no clean per-instance hook), so
/// concurrent tests here would race on shared mutable state -- Swift
/// Testing parallelizes by default, XCTest didn't.
@Suite(.serialized)
struct APIClientTests {
    private func makeClient() -> APIClient {
        StubURLProtocol.reset()
        let settings = ConnectionSettings(baseURL: URL(string: "http://vpn-host:5309")!, token: "test-token-0123456789")
        return APIClient(settings: settings, session: StubURLProtocol.makeSession())
    }

    @Test
    func listProjectsSendsBearerTokenAndDecodesResponse() async throws {
        let client = makeClient()
        StubURLProtocol.stubs["/api/projects"] = .init(
            status: 200,
            body: Data(#"{"projects":[{"id":"p1","name":"Demo","repoPath":"/repo","createdAt":"2026-01-01T00:00:00.000Z"}]}"#.utf8)
        )

        let projects = try await client.listProjects()

        #expect(projects == [Project(id: "p1", name: "Demo", repoPath: "/repo", createdAt: "2026-01-01T00:00:00.000Z")])
        let authHeader = StubURLProtocol.capturedRequests.first?.value(forHTTPHeaderField: "Authorization")
        #expect(authHeader == "Bearer test-token-0123456789")
    }

    @Test
    func listProjectsUnauthorizedThrowsUnauthorized() async {
        let client = makeClient()
        StubURLProtocol.stubs["/api/projects"] = .init(status: 401, body: Data())

        await #expect {
            _ = try await client.listProjects()
        } throws: { error in
            (error as? APIError)?.errorDescription == APIError.unauthorized.errorDescription
        }
    }

    @Test
    func deleteSessionConflictSurfacesMessageAndSessionCount() async throws {
        let client = makeClient()
        StubURLProtocol.stubs["/api/projects/p1/sessions/my-branch"] = .init(
            status: 409,
            body: Data(#"{"error":"Worktree has uncommitted changes","sessionCount":null}"#.utf8)
        )

        do {
            try await client.deleteSession(projectId: "p1", sessionName: "my-branch")
            Issue.record("expected APIError.conflict")
        } catch APIError.conflict(let message, let sessionCount) {
            #expect(message == "Worktree has uncommitted changes")
            #expect(sessionCount == nil)
        }
    }

    @Test
    func deleteProjectConflictSurfacesActiveSessionCount() async throws {
        let client = makeClient()
        StubURLProtocol.stubs["/api/projects/p1"] = .init(
            status: 409,
            body: Data(#"{"error":"Project has active sessions","sessionCount":2}"#.utf8)
        )

        do {
            try await client.deleteProject(id: "p1")
            Issue.record("expected APIError.conflict")
        } catch APIError.conflict(_, let sessionCount) {
            #expect(sessionCount == 2)
        }
    }

    @Test
    func createProjectBadRequestThrowsBadRequestWithServerMessage() async {
        let client = makeClient()
        StubURLProtocol.stubs["/api/projects"] = .init(
            status: 400,
            body: Data(#"{"error":"Missing name or repoPath"}"#.utf8)
        )

        await #expect {
            _ = try await client.createProject(name: "", repoPath: "")
        } throws: { error in
            guard case APIError.badRequest(let message) = error else { return false }
            return message == "Missing name or repoPath"
        }
    }

    // MARK: Environment (docker-compose)

    @Test
    func envStatusDecodesRunningPhase() async throws {
        let client = makeClient()
        StubURLProtocol.stubs["/api/projects/p1/sessions/my-branch/env"] = .init(
            status: 200,
            body: Data(#"{"phase":"running","openUrl":"http://localhost:1234"}"#.utf8)
        )

        let status = try await client.envStatus(projectId: "p1", sessionName: "my-branch")

        #expect(status.phase == .running)
        #expect(status.openUrl == "http://localhost:1234")
    }

    @Test
    func startEnvSendsPostAndSucceedsOn202() async throws {
        let client = makeClient()
        StubURLProtocol.stubs["/api/projects/p1/sessions/my-branch/env"] = .init(status: 202, body: Data())

        try await client.startEnv(projectId: "p1", sessionName: "my-branch")

        #expect(StubURLProtocol.capturedRequests.first?.httpMethod == "POST")
    }

    @Test
    func startEnvAlreadyRunningThrowsConflict() async {
        let client = makeClient()
        StubURLProtocol.stubs["/api/projects/p1/sessions/my-branch/env"] = .init(
            status: 409,
            body: Data(#"{"error":"Environment for \"my-branch\" is already running","sessionCount":null}"#.utf8)
        )

        await #expect {
            try await client.startEnv(projectId: "p1", sessionName: "my-branch")
        } throws: { error in
            guard case APIError.conflict(let message, _) = error else { return false }
            return message.contains("already running")
        }
    }

    @Test
    func stopEnvSendsDeleteAndSucceedsOn204() async throws {
        let client = makeClient()
        StubURLProtocol.stubs["/api/projects/p1/sessions/my-branch/env"] = .init(status: 204, body: Data())

        try await client.stopEnv(projectId: "p1", sessionName: "my-branch")

        #expect(StubURLProtocol.capturedRequests.first?.httpMethod == "DELETE")
    }

    // MARK: Changes / diff

    @Test
    func changesDecodesGroupedResponse() async throws {
        let client = makeClient()
        StubURLProtocol.stubs["/api/projects/p1/sessions/my-branch/changes"] = .init(
            status: 200,
            body: Data(#"{"staged":[],"unstaged":[{"path":"a.txt","oldPath":null,"status":"modified","staged":false}],"untracked":[]}"#.utf8)
        )

        let grouped = try await client.changes(projectId: "p1", sessionName: "my-branch")

        #expect(grouped.unstaged == [ChangedFile(path: "a.txt", oldPath: nil, status: .modified, staged: false)])
    }

    @Test
    func diffSendsPathAndModeQueryItems() async throws {
        let client = makeClient()
        StubURLProtocol.stubs["/api/projects/p1/sessions/my-branch/diff?path=a.txt&mode=unstaged"] = .init(
            status: 200,
            body: Data(#"{"diff":"@@ -1 +1 @@\n-old\n+new","isUntracked":false,"isBinary":false}"#.utf8)
        )

        let diff = try await client.diff(projectId: "p1", sessionName: "my-branch", filePath: "a.txt", mode: .unstaged)

        #expect(diff.diff.contains("+new"))
    }
}
