package com.tanyudii.tmuxweb.domain.model

import kotlinx.serialization.Serializable

/** Mirrors `DirectoryEntry`/`DirectoryListing` in src/directory-browser.ts (backend contract, frozen). */
@Serializable
data class DirectoryEntry(
    val name: String,
    val path: String,
    val isGitRepo: Boolean,
)

@Serializable
data class DirectoryListing(
    val path: String,
    val parentPath: String? = null,
    val isGitRepo: Boolean,
    val entries: List<DirectoryEntry>,
    val truncated: Boolean,
)
