package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
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

/**
 * Runs [delete], routing an [ApiError.Conflict] failure (the resource still
 * has active dependents) to [onConflict] with the server's own explanation,
 * and any other failure to [onError] as a plain message. Shared by
 * [ProjectListViewModel.delete] and `DeleteProjectState.delete`
 * (ui/sessions/SessionListScreen.kt) — both implement the identical
 * "delete, and on a 409 let the caller re-confirm with force" flow for
 * different resources; only extracted where the failure-routing behavior
 * is identical (e.g. [ProjectListViewModel.confirmForceDelete] deliberately
 * does *not* retry-offer force on a second conflict, so it keeps its own
 * simpler handling rather than being forced through this helper).
 */
suspend fun <T> deleteHandlingConflict(
    delete: suspend () -> T,
    onSuccess: (T) -> Unit,
    onConflict: (String) -> Unit,
    onError: (String) -> Unit,
) {
    runSuspendCatching(delete)
        .onSuccess(onSuccess)
        .onFailure { error ->
            if (error is ApiError.Conflict) onConflict(error.serverMessage) else onError(error.toUiMessage())
        }
}
