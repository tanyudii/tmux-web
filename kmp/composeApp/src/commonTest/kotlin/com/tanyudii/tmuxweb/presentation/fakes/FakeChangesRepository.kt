package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.FileDiff
import com.tanyudii.tmuxweb.domain.model.GroupedChanges
import com.tanyudii.tmuxweb.domain.repository.ChangesRepository

private val EMPTY_CHANGES = GroupedChanges(staged = emptyList(), unstaged = emptyList(), untracked = emptyList())

class FakeChangesRepository(private var default: GroupedChanges = EMPTY_CHANGES) : ChangesRepository {
    /** Queue of results `changes()` returns in order, one per call; falls back to [default] once drained. */
    val changesQueue = ArrayDeque<Result<GroupedChanges>>()
    var diffResult: Result<FileDiff> = Result.success(FileDiff(diff = "", isUntracked = false, isBinary = false))

    override suspend fun changes(projectId: String, sessionName: String): GroupedChanges =
        (changesQueue.removeFirstOrNull() ?: Result.success(default)).getOrThrow()

    override suspend fun diff(projectId: String, sessionName: String, filePath: String, mode: DiffMode): FileDiff =
        diffResult.getOrThrow()
}
