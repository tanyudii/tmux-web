package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.FileDiff
import com.tanyudii.tmuxweb.domain.model.GroupedChanges
import kotlinx.serialization.Serializable

/**
 * Mirrors the `/api/projects/:id/sessions/:slug/{changes,diff,stage,unstage,discard}`
 * endpoints — see plan §2.2 and EMB-204.
 */
interface ChangesRepository {
    suspend fun changes(projectId: String, sessionName: String): GroupedChanges
    suspend fun diff(projectId: String, sessionName: String, filePath: String, mode: DiffMode): FileDiff
    suspend fun stage(projectId: String, sessionName: String, filePath: String)
    suspend fun unstage(projectId: String, sessionName: String, filePath: String)
    suspend fun discard(projectId: String, sessionName: String, filePath: String, mode: DiffMode)
}

@Serializable
private data class PathRequest(val path: String)

@Serializable
private data class DiscardRequest(val path: String, val mode: String)

class KtorChangesRepository(private val client: TmuxWebHttpClient) : ChangesRepository {
    override suspend fun changes(projectId: String, sessionName: String): GroupedChanges =
        client.getJson("/api/projects/$projectId/sessions/$sessionName/changes")

    override suspend fun diff(projectId: String, sessionName: String, filePath: String, mode: DiffMode): FileDiff =
        client.getJson(
            "/api/projects/$projectId/sessions/$sessionName/diff",
            mapOf("path" to filePath, "mode" to mode.wireValue),
        )

    override suspend fun stage(projectId: String, sessionName: String, filePath: String) {
        client.postJson<PathRequest, Unit>(
            "/api/projects/$projectId/sessions/$sessionName/stage",
            PathRequest(filePath),
        )
    }

    override suspend fun unstage(projectId: String, sessionName: String, filePath: String) {
        client.postJson<PathRequest, Unit>(
            "/api/projects/$projectId/sessions/$sessionName/unstage",
            PathRequest(filePath),
        )
    }

    override suspend fun discard(projectId: String, sessionName: String, filePath: String, mode: DiffMode) {
        client.postJson<DiscardRequest, Unit>(
            "/api/projects/$projectId/sessions/$sessionName/discard",
            DiscardRequest(filePath, mode.wireValue),
        )
    }
}

private val DiffMode.wireValue: String
    get() = when (this) {
        DiffMode.STAGED -> "staged"
        DiffMode.UNSTAGED -> "unstaged"
        DiffMode.UNTRACKED -> "untracked"
    }
