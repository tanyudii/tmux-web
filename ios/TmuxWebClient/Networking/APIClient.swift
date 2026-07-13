import Foundation

/// REST client mirroring the routes in ../../src/server.ts 1:1. Uses
/// `Authorization: Bearer <token>` exactly like ../../src/auth.ts expects
/// (`extractBearerToken`).
///
/// Session sub-resources (delete/changes/diff) are addressed by
/// `session.name` (the short slug), not `session.fullName` -- that matches
/// how ../../public/app.js builds these URLs. `fullName` is reserved for
/// the `/ws?session=` WebSocket query param (see TerminalSocket.swift).
final class APIClient {
    /// Internal (not `private`) so Views/Terminal/TerminalContainerView.swift
    /// can build a TerminalConnectionInfo from the same settings without a
    /// separate plumbing path.
    let settings: ConnectionSettings
    private let session: URLSession

    init(settings: ConnectionSettings, session: URLSession = .shared) {
        self.settings = settings
        self.session = session
    }

    // MARK: Projects

    func listProjects() async throws -> [Project] {
        let response: ProjectListResponse = try await request(path: "/api/projects", method: "GET")
        return response.projects
    }

    func createProject(name: String, repoPath: String) async throws -> Project {
        try await request(
            path: "/api/projects",
            method: "POST",
            body: NewProjectRequest(name: name, repoPath: repoPath)
        )
    }

    /// - Parameter force: when `false` and the project still has active
    ///   sessions, the server returns 409 with `sessionCount` -- surface
    ///   that to the user and retry with `force: true` if they confirm.
    func deleteProject(id: String, force: Bool = false) async throws {
        try await requestNoContent(
            path: "/api/projects/\(pathEscape(id))",
            method: "DELETE",
            query: force ? [URLQueryItem(name: "force", value: "true")] : []
        )
    }

    // MARK: Sessions

    func listSessions(projectId: String) async throws -> [ProjectSession] {
        let response: SessionListResponse = try await request(
            path: "/api/projects/\(pathEscape(projectId))/sessions",
            method: "GET"
        )
        return response.sessions
    }

    func createSession(projectId: String, name: String) async throws -> ProjectSession {
        try await request(
            path: "/api/projects/\(pathEscape(projectId))/sessions",
            method: "POST",
            body: NewSessionRequest(name: name)
        )
    }

    /// - Parameter force: when `false` and the session's worktree has
    ///   uncommitted changes, the server returns 409 -- surface that and
    ///   retry with `force: true` if the user confirms discarding it.
    func deleteSession(projectId: String, sessionName: String, force: Bool = false) async throws {
        try await requestNoContent(
            path: "/api/projects/\(pathEscape(projectId))/sessions/\(pathEscape(sessionName))",
            method: "DELETE",
            query: force ? [URLQueryItem(name: "force", value: "true")] : []
        )
    }

    // MARK: Changes / diff

    func changes(projectId: String, sessionName: String) async throws -> GroupedChanges {
        try await request(
            path: "/api/projects/\(pathEscape(projectId))/sessions/\(pathEscape(sessionName))/changes",
            method: "GET"
        )
    }

    func diff(projectId: String, sessionName: String, filePath: String, mode: DiffMode) async throws -> FileDiff {
        try await request(
            path: "/api/projects/\(pathEscape(projectId))/sessions/\(pathEscape(sessionName))/diff",
            method: "GET",
            query: [
                URLQueryItem(name: "path", value: filePath),
                URLQueryItem(name: "mode", value: mode.rawValue),
            ]
        )
    }

    // MARK: Core request plumbing

    private func pathEscape(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }

    private func buildRequest(
        path: String,
        method: String,
        query: [URLQueryItem] = [],
        bodyData: Data? = nil
    ) throws -> URLRequest {
        guard var components = URLComponents(url: settings.baseURL, resolvingAgainstBaseURL: false) else {
            throw APIError.badRequest(message: "Invalid server URL")
        }
        components.path = path
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else {
            throw APIError.badRequest(message: "Invalid server URL")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(settings.token)", forHTTPHeaderField: "Authorization")
        if let bodyData {
            request.httpBody = bodyData
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func request<Response: Decodable>(
        path: String,
        method: String,
        query: [URLQueryItem] = []
    ) async throws -> Response {
        let request = try buildRequest(path: path, method: method, query: query)
        return try await perform(request)
    }

    private func request<Body: Encodable, Response: Decodable>(
        path: String,
        method: String,
        query: [URLQueryItem] = [],
        body: Body
    ) async throws -> Response {
        let bodyData = try JSONEncoder().encode(body)
        let request = try buildRequest(path: path, method: method, query: query, bodyData: bodyData)
        return try await perform(request)
    }

    private func requestNoContent(
        path: String,
        method: String,
        query: [URLQueryItem] = []
    ) async throws {
        let request = try buildRequest(path: path, method: method, query: query)
        let (data, response) = try await send(request)
        try checkStatus(response, data: data)
    }

    private func perform<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let (data, response) = try await send(request)
        try checkStatus(response, data: data)
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    private func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch {
            throw APIError.transport(error)
        }
    }

    /// Maps status codes the same way `sendMappedError` does server-side
    /// (../../src/server.ts) -- 400/404/409/401, falling through to a
    /// generic server error for anything else.
    private func checkStatus(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard !(200..<300).contains(http.statusCode) else { return }

        let body = try? JSONDecoder().decode(APIErrorBody.self, from: data)
        let message = body?.error ?? "HTTP \(http.statusCode)"

        switch http.statusCode {
        case 401:
            throw APIError.unauthorized
        case 404:
            throw APIError.notFound(message: message)
        case 409:
            throw APIError.conflict(message: message, sessionCount: body?.sessionCount)
        case 400:
            throw APIError.badRequest(message: message)
        default:
            throw APIError.server(status: http.statusCode, message: message)
        }
    }
}
