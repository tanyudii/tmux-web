package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.ChangedFile
import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.FileStatus
import com.tanyudii.tmuxweb.domain.model.Project
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * Ports ios/TmuxWebClientTests/APIClientTests.swift 1:1 (same fixtures, same
 * status-code-to-ApiError mapping assertions) using Ktor's MockEngine as the
 * direct Kotlin equivalent of StubURLProtocol.
 */
class KtorRepositoriesTest {
    private lateinit var capturedRequest: HttpRequestData

    private fun client(status: HttpStatusCode, body: String): TmuxWebHttpClient {
        val engine = MockEngine { request ->
            capturedRequest = request
            respond(
                content = body,
                status = status,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val httpClient = HttpClient(engine) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }
        return TmuxWebHttpClient(httpClient, baseUrl = "http://vpn-host:5309", token = "test-token-0123456789")
    }

    // MARK: Projects

    @Suppress("MaxLineLength") // JSON fixture reads better on one line than wrapped
    @Test
    fun `listProjects sends bearer token and decodes response`() = runTest {
        // Arrange
        val repo = KtorProjectsRepository(
            client(
                HttpStatusCode.OK,
                """{"projects":[{"id":"p1","name":"Demo","repoPath":"/repo","createdAt":"2026-01-01T00:00:00.000Z"}]}""",
            ),
        )

        // Act
        val projects = repo.listProjects()

        // Assert
        assertEquals(listOf(Project("p1", "Demo", "/repo", "2026-01-01T00:00:00.000Z")), projects)
        assertEquals("Bearer test-token-0123456789", capturedRequest.headers[HttpHeaders.Authorization])
    }

    @Test
    fun `listProjects unauthorized throws Unauthorized`() = runTest {
        val repo = KtorProjectsRepository(client(HttpStatusCode.Unauthorized, ""))

        assertFailsWith<ApiError.Unauthorized> { repo.listProjects() }
    }

    @Test
    fun `deleteProject conflict surfaces active session count`() = runTest {
        val repo = KtorProjectsRepository(
            client(HttpStatusCode.Conflict, """{"error":"Project has active sessions","sessionCount":2}"""),
        )

        val error = assertFailsWith<ApiError.Conflict> { repo.deleteProject("p1") }
        assertEquals(2, error.sessionCount)
    }

    @Test
    fun `createProject bad request throws BadRequest with server message`() = runTest {
        val repo = KtorProjectsRepository(
            client(HttpStatusCode.BadRequest, """{"error":"Missing name or repoPath"}"""),
        )

        val error = assertFailsWith<ApiError.BadRequest> { repo.createProject("", "") }
        assertEquals("Missing name or repoPath", error.serverMessage)
    }

    // MARK: Sessions

    @Test
    fun `deleteSession conflict surfaces message and null session count`() = runTest {
        val repo = KtorSessionsRepository(
            client(HttpStatusCode.Conflict, """{"error":"Worktree has uncommitted changes","sessionCount":null}"""),
        )

        val error = assertFailsWith<ApiError.Conflict> { repo.deleteSession("p1", "my-branch") }
        assertEquals("Worktree has uncommitted changes", error.serverMessage)
        assertEquals(null, error.sessionCount)
    }

    @Test
    fun `closeSplitPane sends DELETE to the split endpoint and succeeds on 204`() = runTest {
        val repo = KtorSessionsRepository(client(HttpStatusCode.NoContent, ""))

        repo.closeSplitPane("p1", "my-branch")

        assertEquals("DELETE", capturedRequest.method.value)
        assertTrue(capturedRequest.url.encodedPath.endsWith("/sessions/my-branch/split"))
    }

    // MARK: Environment (docker-compose)

    @Test
    fun `envStatus decodes running phase`() = runTest {
        val repo = KtorEnvironmentRepository(
            client(
                HttpStatusCode.OK,
                """{"phase":"running","openLinks":[{"label":"web","url":"http://localhost:1234","service":"web"}]}""",
            ),
        )

        val status = repo.envStatus("p1", "my-branch")

        assertEquals("http://localhost:1234", status.openLinks?.single()?.url)
        assertEquals("web", status.openLinks?.single()?.service)
    }

    @Test
    fun `startEnv sends POST and succeeds on 202`() = runTest {
        val repo = KtorEnvironmentRepository(client(HttpStatusCode.Accepted, ""))

        repo.startEnv("p1", "my-branch")

        assertEquals("POST", capturedRequest.method.value)
    }

    @Test
    fun `startEnv already running throws Conflict mentioning already running`() = runTest {
        val repo = KtorEnvironmentRepository(
            client(
                HttpStatusCode.Conflict,
                """{"error":"Environment for \"my-branch\" is already running","sessionCount":null}""",
            ),
        )

        val error = assertFailsWith<ApiError.Conflict> { repo.startEnv("p1", "my-branch") }
        assertTrue(error.serverMessage.contains("already running"))
    }

    @Test
    fun `stopEnv sends DELETE and succeeds on 204`() = runTest {
        val repo = KtorEnvironmentRepository(client(HttpStatusCode.NoContent, ""))

        repo.stopEnv("p1", "my-branch")

        assertEquals("DELETE", capturedRequest.method.value)
    }

    // MARK: Changes / diff

    @Suppress("MaxLineLength") // JSON fixture reads better on one line than wrapped
    @Test
    fun `changes decodes grouped response`() = runTest {
        val repo = KtorChangesRepository(
            client(
                HttpStatusCode.OK,
                """{"staged":[],"unstaged":[{"path":"a.txt","oldPath":null,"status":"modified","staged":false}],"untracked":[]}""",
            ),
        )

        val grouped = repo.changes("p1", "my-branch")

        assertEquals(listOf(ChangedFile("a.txt", null, FileStatus.MODIFIED, false)), grouped.unstaged)
    }

    @Test
    fun `diff sends path and mode query items`() = runTest {
        val repo = KtorChangesRepository(
            client(HttpStatusCode.OK, """{"diff":"@@ -1 +1 @@\n-old\n+new","isUntracked":false,"isBinary":false}"""),
        )

        val diff = repo.diff("p1", "my-branch", "a.txt", DiffMode.UNSTAGED)

        assertTrue(diff.diff.contains("+new"))
        assertEquals("a.txt", capturedRequest.url.parameters["path"])
        assertEquals("unstaged", capturedRequest.url.parameters["mode"])
    }

    // MARK: Session templates (EMB-220)

    @Suppress("MaxLineLength") // JSON fixture reads better on one line than wrapped
    @Test
    fun `listTemplates decodes the templates envelope`() = runTest {
        val repo = KtorSessionTemplatesRepository(
            client(
                HttpStatusCode.OK,
                """{"templates":[{"id":"t1","projectId":"p1","name":"Dev server","startupCommand":"npm run dev","createdAt":"2026-01-01T00:00:00.000Z"}]}""",
            ),
        )

        val templates = repo.listTemplates("p1")

        assertEquals(1, templates.size)
        assertEquals("Dev server", templates.single().name)
        assertEquals("npm run dev", templates.single().startupCommand)
    }

    @Suppress("MaxLineLength") // JSON fixture reads better on one line than wrapped
    @Test
    fun `createTemplate sends POST with name and startupCommand and decodes the created template`() = runTest {
        val repo = KtorSessionTemplatesRepository(
            client(
                HttpStatusCode.Created,
                """{"id":"t1","projectId":"p1","name":"Dev server","startupCommand":"npm run dev","createdAt":"2026-01-01T00:00:00.000Z"}""",
            ),
        )

        val template = repo.createTemplate("p1", "Dev server", "npm run dev")

        assertEquals("POST", capturedRequest.method.value)
        assertEquals("t1", template.id)
        assertEquals("Dev server", template.name)
    }

    @Test
    fun `createTemplate bad request throws BadRequest with server message`() = runTest {
        val repo = KtorSessionTemplatesRepository(
            client(HttpStatusCode.BadRequest, """{"error":"Template name must not be empty"}"""),
        )

        val error = assertFailsWith<ApiError.BadRequest> { repo.createTemplate("p1", "", null) }
        assertEquals("Template name must not be empty", error.serverMessage)
    }

    @Suppress("MaxLineLength") // JSON fixture reads better on one line than wrapped
    @Test
    fun `updateTemplate sends PUT and decodes the returned body via decodeBody`() = runTest {
        val repo = KtorSessionTemplatesRepository(
            client(
                HttpStatusCode.OK,
                """{"id":"t1","projectId":"p1","name":"Renamed","startupCommand":"npm test","createdAt":"2026-01-01T00:00:00.000Z"}""",
            ),
        )

        val template = repo.updateTemplate("p1", "t1", "Renamed", "npm test")

        assertEquals("PUT", capturedRequest.method.value)
        assertEquals("Renamed", template.name)
        assertEquals("npm test", template.startupCommand)
    }

    @Test
    fun `updateTemplate not found throws NotFound`() = runTest {
        val repo = KtorSessionTemplatesRepository(client(HttpStatusCode.NotFound, """{"error":"Template not found"}"""))

        assertFailsWith<ApiError.NotFound> { repo.updateTemplate("p1", "missing", "x", null) }
    }

    @Test
    fun `deleteTemplate sends DELETE to the template endpoint and succeeds on 204`() = runTest {
        val repo = KtorSessionTemplatesRepository(client(HttpStatusCode.NoContent, ""))

        repo.deleteTemplate("p1", "t1")

        assertEquals("DELETE", capturedRequest.method.value)
        assertTrue(capturedRequest.url.encodedPath.endsWith("/templates/t1"))
    }

    // MARK: Access log (EMB-223)

    @Suppress("MaxLineLength") // JSON fixture reads better on one line than wrapped
    @Test
    fun `listEntries decodes the entries envelope`() = runTest {
        val repo = KtorAccessLogRepository(
            client(
                HttpStatusCode.OK,
                """{"entries":[{"timestamp":"2026-01-01T00:00:00.000Z","ip":"203.0.113.5","method":"GET","path":"/api/projects","outcome":"authorized"}]}""",
            ),
        )

        val entries = repo.listEntries()

        assertEquals(1, entries.size)
        assertEquals("authorized", entries.single().outcome)
        assertEquals("/api/projects", entries.single().path)
        assertEquals("Bearer test-token-0123456789", capturedRequest.headers[HttpHeaders.Authorization])
    }

    @Test
    fun `listEntries unauthorized throws Unauthorized`() = runTest {
        val repo = KtorAccessLogRepository(client(HttpStatusCode.Unauthorized, ""))

        assertFailsWith<ApiError.Unauthorized> { repo.listEntries() }
    }
}
