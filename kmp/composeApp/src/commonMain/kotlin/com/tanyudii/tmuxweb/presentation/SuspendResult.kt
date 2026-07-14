package com.tanyudii.tmuxweb.presentation

import kotlinx.coroutines.CancellationException

/**
 * [runCatching] silently swallows [CancellationException], which breaks
 * structured concurrency — a cancelled coroutine must keep propagating
 * cancellation, not report it as a data-level failure (see the user's global
 * coding-style rule: "Never catch CancellationException — always rethrow
 * it"). Every ViewModel in this package uses this instead of [runCatching]
 * around suspend repository calls.
 */
// Catching Throwable here IS the point -- this is the one place that
// stands between arbitrary repository/network failures and typed UI state,
// same boundary rationale as TmuxWebHttpClient.decodeBody's suppression.
@Suppress("TooGenericExceptionCaught")
suspend fun <T> runSuspendCatching(block: suspend () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Throwable) {
        Result.failure(e)
    }

/** Every [com.tanyudii.tmuxweb.data.remote.ApiError] carries a user-displayable message already. */
fun Throwable.toUiMessage(): String = message ?: "Something went wrong."
