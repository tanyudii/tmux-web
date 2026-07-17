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
    var stageResult: Result<Unit> = Result.success(Unit)
    var unstageResult: Result<Unit> = Result.success(Unit)
    var discardResult: Result<Unit> = Result.success(Unit)

    val stageCalls = mutableListOf<String>()
    val unstageCalls = mutableListOf<String>()
    val discardCalls = mutableListOf<Pair<String, DiffMode>>()

    override suspend fun changes(projectId: String, sessionName: String): GroupedChanges =
        (changesQueue.removeFirstOrNull() ?: Result.success(default)).getOrThrow()

    override suspend fun diff(projectId: String, sessionName: String, filePath: String, mode: DiffMode): FileDiff =
        diffResult.getOrThrow()

    override suspend fun stage(projectId: String, sessionName: String, filePath: String) {
        stageCalls.add(filePath)
        stageResult.getOrThrow()
    }

    override suspend fun unstage(projectId: String, sessionName: String, filePath: String) {
        unstageCalls.add(filePath)
        unstageResult.getOrThrow()
    }

    override suspend fun discard(projectId: String, sessionName: String, filePath: String, mode: DiffMode) {
        discardCalls.add(filePath to mode)
        discardResult.getOrThrow()
    }
}
