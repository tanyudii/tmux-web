package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.domain.model.DirectoryListing
import com.tanyudii.tmuxweb.domain.repository.BrowseRepository

class FakeBrowseRepository(private var default: DirectoryListing? = null) : BrowseRepository {
    /** Queue of results `browse()` returns in order, one per call; falls back to [default] once drained. */
    val browseQueue = ArrayDeque<Result<DirectoryListing>>()
    val requestedPaths = mutableListOf<String?>()

    override suspend fun browse(path: String?): DirectoryListing {
        requestedPaths.add(path)
        val result = browseQueue.removeFirstOrNull()
            ?: default?.let { Result.success(it) }
            ?: error("FakeBrowseRepository: no result queued and no default set")
        return result.getOrThrow()
    }
}
