package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.SessionEvent
import com.tanyudii.tmuxweb.presentation.fakes.FakeSessionEventsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

class SessionEventsViewModelTest {
    private fun event(type: String = "created") = SessionEvent(
        timestamp = "2026-01-01T00:00:00.000Z",
        projectId = "p1",
        sessionSlug = "feature-x",
        type = type,
    )

    private fun viewModel(repository: FakeSessionEventsRepository): SessionEventsViewModel {
        val scope = CoroutineScope(UnconfinedTestDispatcher())
        return SessionEventsViewModel("p1", "feature-x", repository, scope)
    }

    @Test
    fun `loads events on init and clears the loading flag`() {
        val vm = viewModel(FakeSessionEventsRepository(listOf(event())))

        val state = vm.state.value
        assertFalse(state.isLoading)
        assertEquals(listOf(event()), state.events)
        assertNull(state.errorMessage)
    }

    @Test
    fun `surfaces a failure message when the load fails`() {
        val repository = FakeSessionEventsRepository().apply { listError = ApiError.Unauthorized }
        val vm = viewModel(repository)

        assertFalse(vm.state.value.isLoading)
        assertEquals(emptyList(), vm.state.value.events)
        assertEquals(ApiError.Unauthorized.toUiMessage(), vm.state.value.errorMessage)
    }

    @Test
    fun `refresh reloads events`() {
        val vm = viewModel(FakeSessionEventsRepository(listOf(event("created"))))
        assertEquals(listOf(event("created")), vm.state.value.events)

        val vm2 = viewModel(FakeSessionEventsRepository(listOf(event("deleted"))))
        vm2.refresh()

        assertEquals(listOf(event("deleted")), vm2.state.value.events)
    }
}
