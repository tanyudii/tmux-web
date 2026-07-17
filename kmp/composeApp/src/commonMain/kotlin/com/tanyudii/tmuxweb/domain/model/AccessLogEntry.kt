package com.tanyudii.tmuxweb.domain.model

import kotlinx.serialization.Serializable

/**
 * Mirrors `AccessLogEntry` in src/access-log.ts (EMB-223). The shared
 * bearer token isn't per-user, so this identifies *what happened when from
 * which IP* -- not *who* in any personal sense; that limitation is
 * deliberate, see access-log.ts's doc comment.
 */
@Serializable
data class AccessLogEntry(
    val timestamp: String,
    val ip: String,
    val method: String,
    val path: String,
    val outcome: String,
)

@Serializable
data class AccessLogResponse(val entries: List<AccessLogEntry>)
