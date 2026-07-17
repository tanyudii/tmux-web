package com.tanyudii.tmuxweb.domain.model

import kotlinx.serialization.Serializable

/** Mirrors `ProjectSession` in src/project-sessions.ts. */
@Serializable
data class ProjectSession(
    val name: String,
    val fullName: String,
    val windows: Int,
    // Per-window display names, ordered by tmux window index -- best-effort,
    // so it defaults to empty (falling back to a "win$index" placeholder,
    // see WindowTabs.kt) rather than failing decode when the backend
    // couldn't fetch them (see project-sessions.ts's fetchWindowNames).
    val windowNames: List<String> = emptyList(),
    val attached: Boolean,
)

@Serializable
data class SessionListResponse(val sessions: List<ProjectSession>)

@Serializable
data class NewSessionRequest(val name: String, val startupCommand: String? = null)

/** Mirrors the `{merged}` body of `GET .../branch-merged` (src/server.ts, EMB-207). */
@Serializable
data class BranchMergedResponse(val merged: Boolean)
