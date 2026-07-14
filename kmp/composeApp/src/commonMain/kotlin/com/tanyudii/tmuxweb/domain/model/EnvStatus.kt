package com.tanyudii.tmuxweb.domain.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Mirrors `EnvPhase` in src/session-env.ts. */
@Serializable
enum class EnvPhase {
    @SerialName("unavailable") UNAVAILABLE,
    @SerialName("idle") IDLE,
    @SerialName("starting") STARTING,
    @SerialName("running") RUNNING,
    @SerialName("error") ERROR,
    @SerialName("stopping") STOPPING,
}

/** Mirrors `ComposeServiceStatus` in src/docker-compose.ts. */
@Serializable
data class ComposeServiceStatus(
    val service: String,
    val state: String,
    val health: String? = null,
)

/** Mirrors `EnvStatus` in src/session-env.ts. */
@Serializable
data class EnvStatus(
    val phase: EnvPhase,
    val openUrl: String? = null,
    val message: String? = null,
    val services: List<ComposeServiceStatus>? = null,
)
