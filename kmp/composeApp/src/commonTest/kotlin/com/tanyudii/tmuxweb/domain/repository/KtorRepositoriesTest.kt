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

    // MARK: Environment (docker-compose)

    @Test
    fun `envStatus decodes running phase`() = runTest {
        val repo = KtorEnvironmentRepository(
            client(HttpStatusCode.OK, """{"phase":"running","openUrl":"http://localhost:1234"}"""),
        )

        val status = repo.envStatus("p1", "my-branch")

        assertEquals("http://localhost:1234", status.openUrl)
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
}
