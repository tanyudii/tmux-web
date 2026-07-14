package com.tanyudii.tmuxweb.domain.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Mirrors `SessionCreationPhase`/`SessionCreationStatus` in src/project-sessions.ts. */
@Serializable
enum class SessionCreationPhase {
    @SerialName("creating") CREATING,
    @SerialName("ready") READY,
    @SerialName("error") ERROR,
}

@Serializable
data class SessionCreationStatus(
    val phase: SessionCreationPhase,
    val message: String? = null,
    val session: ProjectSession? = null,
)

/**
 * The fast `202 Accepted` response session creation returns immediately,
 * before the worktree/tmux work happens in the background — mirrors
 * `{ name, fullName }` in src/project-sessions.ts.
 */
@Serializable
data class PendingSessionCreation(val name: String, val fullName: String)
