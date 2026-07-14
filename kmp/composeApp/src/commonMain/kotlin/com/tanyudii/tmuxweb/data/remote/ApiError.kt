package com.tanyudii.tmuxweb.data.remote

import kotlinx.serialization.Serializable

/** Mirrors the error shapes `sendMappedError` (src/server.ts) maps HTTP status codes to. */
sealed class ApiError(message: String) : Exception(message) {
    data object Unauthorized : ApiError("Token is invalid or expired.")

    data class NotFound(val serverMessage: String) : ApiError(serverMessage)

    data class BadRequest(val serverMessage: String) : ApiError(serverMessage)

    /**
     * 409 — e.g. a session's worktree has uncommitted changes and the caller
     * must confirm force-delete, or a project still has active sessions.
     */
    data class Conflict(val serverMessage: String, val sessionCount: Int?) : ApiError(serverMessage)

    data class Server(val status: Int, val serverMessage: String) : ApiError(serverMessage)

    data class Transport(val throwable: Throwable) : ApiError("Could not reach the server: ${throwable.message}")

    data class Decoding(val throwable: Throwable) : ApiError("Server response did not match the expected format.")
}

@Serializable
data class ApiErrorBody(val error: String, val sessionCount: Int? = null)
