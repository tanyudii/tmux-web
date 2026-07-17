package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.domain.model.EnvPhase
import com.tanyudii.tmuxweb.domain.model.EnvStatus
import com.tanyudii.tmuxweb.domain.repository.EnvironmentRepository

class FakeEnvironmentRepository(private val default: EnvStatus = EnvStatus(phase = EnvPhase.UNAVAILABLE)) :
    EnvironmentRepository {
    /** Queue of results `envStatus()` returns in order, one per call; falls back to [default] once drained. */
    val statusQueue = ArrayDeque<Result<EnvStatus>>()
    var startError: Throwable? = null
    var stopError: Throwable? = null
    var cancelError: Throwable? = null
    var startCallCount = 0
    var stopCallCount = 0
    var cancelCallCount = 0

    override suspend fun envStatus(projectId: String, sessionName: String): EnvStatus =
        (statusQueue.removeFirstOrNull() ?: Result.success(default)).getOrThrow()

    override suspend fun startEnv(projectId: String, sessionName: String) {
        startCallCount++
        startError?.let { throw it }
    }

    override suspend fun stopEnv(projectId: String, sessionName: String) {
        stopCallCount++
        stopError?.let { throw it }
    }

    override suspend fun cancelEnv(projectId: String, sessionName: String) {
        cancelCallCount++
        cancelError?.let { throw it }
    }
}
