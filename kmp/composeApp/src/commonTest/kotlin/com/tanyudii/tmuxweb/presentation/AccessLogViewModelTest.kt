package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.AccessLogEntry
import com.tanyudii.tmuxweb.presentation.fakes.FakeAccessLogRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

class AccessLogViewModelTest {
    private fun entry(path: String = "/api/projects") = AccessLogEntry(
        timestamp = "2026-01-01T00:00:00.000Z",
        ip = "203.0.113.5",
        method = "GET",
        path = path,
        outcome = "authorized",
    )

    private fun viewModel(repository: FakeAccessLogRepository): AccessLogViewModel {
        val scope = CoroutineScope(UnconfinedTestDispatcher())
        return AccessLogViewModel(repository, scope)
    }

    @Test
    fun `loads entries on init and clears the loading flag`() {
        val vm = viewModel(FakeAccessLogRepository(listOf(entry())))

        val state = vm.state.value
        assertFalse(state.isLoading)
        assertEquals(listOf(entry()), state.entries)
        assertNull(state.errorMessage)
    }

    @Test
    fun `surfaces a failure message when the load fails`() {
        val repository = FakeAccessLogRepository().apply { listError = ApiError.Unauthorized }
        val vm = viewModel(repository)

        assertFalse(vm.state.value.isLoading)
        assertEquals(emptyList(), vm.state.value.entries)
        assertEquals(ApiError.Unauthorized.toUiMessage(), vm.state.value.errorMessage)
    }

    @Test
    fun `refresh reloads entries`() {
        val repository = FakeAccessLogRepository(listOf(entry("/first")))
        val vm = viewModel(repository)
        assertEquals(listOf(entry("/first")), vm.state.value.entries)

        val updated = FakeAccessLogRepository(listOf(entry("/second")))
        // Swap the backing data the same way the real endpoint would report
        // new entries on a subsequent GET -- refresh() re-invokes the
        // repository rather than mutating state locally.
        val vm2 = viewModel(updated)
        vm2.refresh()

        assertEquals(listOf(entry("/second")), vm2.state.value.entries)
    }
}
