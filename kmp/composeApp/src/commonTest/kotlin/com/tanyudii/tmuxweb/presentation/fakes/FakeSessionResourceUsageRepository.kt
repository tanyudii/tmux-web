package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.domain.model.SessionResourceUsage
import com.tanyudii.tmuxweb.domain.repository.SessionResourceUsageRepository

class FakeSessionResourceUsageRepository(
    private val usage: SessionResourceUsage = SessionResourceUsage(available = false),
) : SessionResourceUsageRepository {
    var getUsageError: Throwable? = null
    var callCount = 0

    override suspend fun getUsage(projectId: String, sessionName: String): SessionResourceUsage {
        callCount++
        getUsageError?.let { throw it }
        return usage
    }
}
