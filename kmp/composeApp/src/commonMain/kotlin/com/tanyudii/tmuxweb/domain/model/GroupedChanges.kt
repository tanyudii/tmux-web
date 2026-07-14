package com.tanyudii.tmuxweb.domain.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Mirrors `FileStatus` in src/git-status.ts. */
@Serializable
enum class FileStatus {
    @SerialName("modified") MODIFIED,
    @SerialName("added") ADDED,
    @SerialName("deleted") DELETED,
    @SerialName("renamed") RENAMED,
    @SerialName("untracked") UNTRACKED,
}

/** Mirrors `ChangedFile` in src/git-status.ts. */
@Serializable
data class ChangedFile(
    val path: String,
    val oldPath: String? = null,
    val status: FileStatus,
    val staged: Boolean,
)

/** Mirrors `GroupedChanges` in src/git-status.ts. */
@Serializable
data class GroupedChanges(
    val staged: List<ChangedFile>,
    val unstaged: List<ChangedFile>,
    val untracked: List<ChangedFile>,
)

/** Mirrors `DiffMode` in src/git-status.ts. */
@Serializable
enum class DiffMode {
    @SerialName("staged") STAGED,
    @SerialName("unstaged") UNSTAGED,
    @SerialName("untracked") UNTRACKED,
}

/** Mirrors `FileDiff` in src/git-status.ts. */
@Serializable
data class FileDiff(
    val diff: String,
    val isUntracked: Boolean,
    val isBinary: Boolean,
)
