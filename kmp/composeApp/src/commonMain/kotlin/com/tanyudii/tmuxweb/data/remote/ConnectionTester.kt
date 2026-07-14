package com.tanyudii.tmuxweb.data.remote

import com.tanyudii.tmuxweb.domain.repository.KtorProjectsRepository
import io.ktor.client.HttpClient

/**
 * Ports ConnectionSettingsView.swift's `APIClient(settings: candidate).listProjects()` —
 * "does this URL/token combination actually work" is exercised with the same
 * real endpoint the project list screen uses, not a dedicated healthcheck
 * route the backend doesn't have.
 */
fun interface ConnectionTester {
    suspend fun test(baseUrl: String, token: String)
}

class KtorConnectionTester(private val httpClient: HttpClient) : ConnectionTester {
    override suspend fun test(baseUrl: String, token: String) {
        KtorProjectsRepository(TmuxWebHttpClient(httpClient, baseUrl, token)).listProjects()
    }
}
