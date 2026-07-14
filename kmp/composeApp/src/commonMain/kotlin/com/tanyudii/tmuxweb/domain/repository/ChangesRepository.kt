package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.FileDiff
import com.tanyudii.tmuxweb.domain.model.GroupedChanges

/** Mirrors the `/api/projects/:id/sessions/:slug/{changes,diff}` endpoints — see plan §2.2. */
interface ChangesRepository {
    suspend fun changes(projectId: String, sessionName: String): GroupedChanges
    suspend fun diff(projectId: String, sessionName: String, filePath: String, mode: DiffMode): FileDiff
}

class KtorChangesRepository(private val client: TmuxWebHttpClient) : ChangesRepository {
    override suspend fun changes(projectId: String, sessionName: String): GroupedChanges =
        client.getJson("/api/projects/$projectId/sessions/$sessionName/changes")

    override suspend fun diff(projectId: String, sessionName: String, filePath: String, mode: DiffMode): FileDiff =
        client.getJson(
            "/api/projects/$projectId/sessions/$sessionName/diff",
            mapOf("path" to filePath, "mode" to mode.wireValue),
        )
}

private val DiffMode.wireValue: String
    get() = when (this) {
        DiffMode.STAGED -> "staged"
        DiffMode.UNSTAGED -> "unstaged"
        DiffMode.UNTRACKED -> "untracked"
    }
