package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.DirectoryListing

/** Mirrors the `GET /api/browse` endpoint (src/server.ts) — see plan §2.2. */
interface BrowseRepository {
    suspend fun browse(path: String? = null): DirectoryListing
}

class KtorBrowseRepository(private val client: TmuxWebHttpClient) : BrowseRepository {
    override suspend fun browse(path: String?): DirectoryListing =
        client.getJson("/api/browse", if (path != null) mapOf("path" to path) else emptyMap())
}
