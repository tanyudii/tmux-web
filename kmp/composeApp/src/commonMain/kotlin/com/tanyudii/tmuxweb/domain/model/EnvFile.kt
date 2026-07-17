package com.tanyudii.tmuxweb.domain.model

import kotlinx.serialization.Serializable

/** Mirrors `EnvFileEntry`/the `.../env-files` response shapes in src/env-editor.ts. See EMB-210. */
@Serializable
data class EnvFile(
    val filename: String,
    val content: String,
)

@Serializable
data class EnvFileListResponse(val files: List<EnvFile>)
