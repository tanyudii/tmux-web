package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.EnvPhase
import com.tanyudii.tmuxweb.domain.model.EnvStatus
import com.tanyudii.tmuxweb.presentation.fakes.FakeEnvironmentRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Ports EnvironmentBar.swift's 3s poll loop + setup/stop/logs state machine. */
class EnvironmentViewModelTest {
    private fun viewModel(repository: FakeEnvironmentRepository, scheduler: TestCoroutineScheduler) =
        EnvironmentViewModel("proj-1", "main", repository, CoroutineScope(StandardTestDispatcher(scheduler)))

    @Test
    fun `initial poll populates status`() = runTest {
        val repository = FakeEnvironmentRepository(default = EnvStatus(phase = EnvPhase.IDLE))
        val viewModel = viewModel(repository, testScheduler)

        advanceUntilIdle()

        assertEquals(EnvPhase.IDLE, viewModel.state.value.status?.phase)
    }

    @Test
    fun `poll refreshes again after 3 seconds`() = runTest {
        val repository = FakeEnvironmentRepository()
        repository.statusQueue.addAll(
            listOf(
                Result.success(EnvStatus(phase = EnvPhase.STARTING)),
                Result.success(EnvStatus(phase = EnvPhase.RUNNING)),
            ),
        )
        val viewModel = viewModel(repository, testScheduler)
        advanceUntilIdle()
        assertEquals(EnvPhase.STARTING, viewModel.state.value.status?.phase)

        advanceTimeBy(3_001)

        assertEquals(EnvPhase.RUNNING, viewModel.state.value.status?.phase)
    }

    @Test
    fun `poll failure is silent -- no error message, last known status kept`() = runTest {
        val repository = FakeEnvironmentRepository(default = EnvStatus(phase = EnvPhase.RUNNING))
        repository.statusQueue.add(Result.success(EnvStatus(phase = EnvPhase.RUNNING)))
        val viewModel = viewModel(repository, testScheduler)
        advanceUntilIdle()
        repository.statusQueue.add(Result.failure(ApiError.Server(500, "hiccup")))

        advanceTimeBy(3_001)

        assertNull(viewModel.state.value.errorMessage)
        assertEquals(EnvPhase.RUNNING, viewModel.state.value.status?.phase)
    }

    @Test
    fun `setup calls startEnv, toggles busy, and refreshes status`() = runTest {
        val repository = FakeEnvironmentRepository()
        repository.statusQueue.addAll(
            listOf(
                Result.success(EnvStatus(phase = EnvPhase.IDLE)),
                Result.success(EnvStatus(phase = EnvPhase.STARTING)),
            ),
        )
        val viewModel = viewModel(repository, testScheduler)
        advanceUntilIdle()

        viewModel.setup()
        advanceUntilIdle()

        assertEquals(1, repository.startCallCount)
        assertFalse(viewModel.state.value.isBusy)
        assertEquals(EnvPhase.STARTING, viewModel.state.value.status?.phase)
    }

    @Test
    fun `setup failure surfaces error and clears busy`() = runTest {
        val repository = FakeEnvironmentRepository().apply { startError = ApiError.Server(500, "docker unavailable") }
        val viewModel = viewModel(repository, testScheduler)
        advanceUntilIdle()

        viewModel.setup()
        advanceUntilIdle()

        assertEquals("docker unavailable", viewModel.state.value.errorMessage)
        assertFalse(viewModel.state.value.isBusy)
    }

    @Test
    fun `requestStop shows confirm, cancelStop dismisses it without stopping`() = runTest {
        val repository = FakeEnvironmentRepository()
        val viewModel = viewModel(repository, testScheduler)
        advanceUntilIdle()

        viewModel.requestStop()
        assertTrue(viewModel.state.value.isShowingStopConfirm)

        viewModel.cancelStop()
        advanceUntilIdle()

        assertFalse(viewModel.state.value.isShowingStopConfirm)
        assertEquals(0, repository.stopCallCount)
    }

    @Test
    fun `stop calls stopEnv, dismisses confirm, and refreshes status`() = runTest {
        val repository = FakeEnvironmentRepository()
        repository.statusQueue.addAll(
            listOf(
                Result.success(EnvStatus(phase = EnvPhase.RUNNING)),
                Result.success(EnvStatus(phase = EnvPhase.IDLE)),
            ),
        )
        val viewModel = viewModel(repository, testScheduler)
        advanceUntilIdle()
        viewModel.requestStop()

        viewModel.stop()
        advanceUntilIdle()

        assertEquals(1, repository.stopCallCount)
        assertFalse(viewModel.state.value.isShowingStopConfirm)
        assertEquals(EnvPhase.IDLE, viewModel.state.value.status?.phase)
    }

    @Test
    fun `showLogs and hideLogs toggle the logs sheet`() = runTest {
        val repository = FakeEnvironmentRepository()
        val viewModel = viewModel(repository, testScheduler)
        advanceUntilIdle()

        viewModel.showLogs()
        assertTrue(viewModel.state.value.isShowingLogs)

        viewModel.hideLogs()
        assertFalse(viewModel.state.value.isShowingLogs)
    }

    @Test
    fun `dismissError clears error message`() = runTest {
        val repository = FakeEnvironmentRepository().apply { startError = ApiError.Server(500, "boom") }
        val viewModel = viewModel(repository, testScheduler)
        advanceUntilIdle()
        viewModel.setup()
        advanceUntilIdle()

        viewModel.dismissError()

        assertNull(viewModel.state.value.errorMessage)
    }
}
