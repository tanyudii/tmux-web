package com.tanyudii.tmuxweb.domain.model

import kotlinx.serialization.Serializable

/** Mirrors `ComposeResourceUsage` in src/docker-compose.ts (EMB-214). */
@Serializable
data class ComposeResourceUsage(
    val service: String,
    val cpuPercent: Double,
    val memUsageBytes: Double,
    val memLimitBytes: Double,
)

/**
 * Mirrors the `GET .../sessions/:name/resource-usage` response body
 * (src/session-env.ts's `SessionResourceUsage`, EMB-214). `available =
 * false` means the session never opted into a docker-compose environment
 * -- not an error, the UI shows "N/A" for it.
 */
@Serializable
data class SessionResourceUsage(
    val available: Boolean,
    val services: List<ComposeResourceUsage> = emptyList(),
)
