package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.domain.model.AccessLogEntry
import com.tanyudii.tmuxweb.domain.repository.AccessLogRepository

class FakeAccessLogRepository(private val entries: List<AccessLogEntry> = emptyList()) : AccessLogRepository {
    var listError: Throwable? = null

    override suspend fun listEntries(): List<AccessLogEntry> {
        listError?.let { throw it }
        return entries
    }
}
