package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.ComposeResourceUsage
import com.tanyudii.tmuxweb.domain.model.SessionResourceUsage
import com.tanyudii.tmuxweb.presentation.fakes.FakeSessionResourceUsageRepository
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Same 5s poll-loop idiom as [ChangesViewModelTest] -- launched on
 * [TestScope.backgroundScope] (exempt from "must finish" checks) since the
 * loop runs forever, settled with [runCurrent] rather than
 * `advanceUntilIdle()`.
 */
class SessionResourceUsageViewModelTest {
    private val unavailable = SessionResourceUsage(available = false)
    private val running = SessionResourceUsage(
        available = true,
        services = listOf(
            ComposeResourceUsage("web", cpuPercent = 12.3, memUsageBytes = 100.0, memLimitBytes = 1000.0),
        ),
    )

    private fun TestScope.viewModel(repository: FakeSessionResourceUsageRepository) =
        SessionResourceUsageViewModel("proj-1", "feature-x", repository, backgroundScope)

    @Test
    fun `state is null before the first poll resolves`() = runTest {
        val viewModel = SessionResourceUsageViewModel(
            "proj-1",
            "feature-x",
            FakeSessionResourceUsageRepository(unavailable),
            backgroundScope,
        )

        assertNull(viewModel.state.value)
    }

    @Test
    fun `initial poll populates state`() = runTest {
        val viewModel = viewModel(FakeSessionResourceUsageRepository(running))

        runCurrent()

        assertEquals(running, viewModel.state.value)
    }

    @Test
    fun `reports available=false for a session with no docker-compose environment`() = runTest {
        val viewModel = viewModel(FakeSessionResourceUsageRepository(unavailable))

        runCurrent()

        assertEquals(unavailable, viewModel.state.value)
    }

    @Test
    fun `polls again after 5 seconds`() = runTest {
        val repository = FakeSessionResourceUsageRepository(running)
        val viewModel = viewModel(repository)
        runCurrent()
        assertEquals(1, repository.callCount)

        advanceTimeBy(5_001)

        assertEquals(2, repository.callCount)
    }

    @Test
    fun `a transient poll failure is swallowed leaving the last good reading on screen`() = runTest {
        val repository = FakeSessionResourceUsageRepository(running)
        val viewModel = viewModel(repository)
        runCurrent()
        assertEquals(running, viewModel.state.value)

        repository.getUsageError = ApiError.Server(500, "boom")
        advanceTimeBy(5_001)

        assertEquals(running, viewModel.state.value)
    }
}
