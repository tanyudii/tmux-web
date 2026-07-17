package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.EnvPhase
import com.tanyudii.tmuxweb.domain.model.EnvStatus
import com.tanyudii.tmuxweb.presentation.fakes.FakeEnvironmentRepository
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Ports EnvironmentBar.swift's 3s poll loop + setup/stop/logs state machine.
 * The poll loop runs forever (`while (isActive)`), so it's launched on
 * [TestScope.backgroundScope] (exempt from kotlinx-coroutines-test's "must
 * finish" checks) and every settle point uses [runCurrent] instead of
 * `advanceUntilIdle()`, which would spin forever chasing an infinite
 * recurring `delay()`.
 */
class EnvironmentViewModelTest {
    private fun TestScope.viewModel(repository: FakeEnvironmentRepository) =
        EnvironmentViewModel("proj-1", "main", repository, backgroundScope)

    @Test
    fun `initial poll populates status`() = runTest {
        val repository = FakeEnvironmentRepository(default = EnvStatus(phase = EnvPhase.IDLE))
        val viewModel = viewModel(repository)

        runCurrent()

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
        val viewModel = viewModel(repository)
        runCurrent()
        assertEquals(EnvPhase.STARTING, viewModel.state.value.status?.phase)

        advanceTimeBy(3_001)

        assertEquals(EnvPhase.RUNNING, viewModel.state.value.status?.phase)
    }

    @Test
    fun `poll failure is silent -- no error message and last known status is kept`() = runTest {
        val repository = FakeEnvironmentRepository(default = EnvStatus(phase = EnvPhase.RUNNING))
        repository.statusQueue.add(Result.success(EnvStatus(phase = EnvPhase.RUNNING)))
        val viewModel = viewModel(repository)
        runCurrent()
        repository.statusQueue.add(Result.failure(ApiError.Server(500, "hiccup")))

        advanceTimeBy(3_001)

        assertNull(viewModel.state.value.errorMessage)
        assertEquals(EnvPhase.RUNNING, viewModel.state.value.status?.phase)
    }

    @Test
    fun `setup calls startEnv and toggles busy while refreshing status`() = runTest {
        val repository = FakeEnvironmentRepository()
        repository.statusQueue.addAll(
            listOf(
                Result.success(EnvStatus(phase = EnvPhase.IDLE)),
                Result.success(EnvStatus(phase = EnvPhase.STARTING)),
            ),
        )
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.setup()
        runCurrent()

        assertEquals(1, repository.startCallCount)
        assertFalse(viewModel.state.value.isBusy)
        assertEquals(EnvPhase.STARTING, viewModel.state.value.status?.phase)
    }

    @Test
    fun `setup failure surfaces error and clears busy`() = runTest {
        val repository = FakeEnvironmentRepository().apply { startError = ApiError.Server(500, "docker unavailable") }
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.setup()
        runCurrent()

        assertEquals("docker unavailable", viewModel.state.value.errorMessage)
        assertFalse(viewModel.state.value.isBusy)
    }

    @Test
    fun `requestStop shows confirm and cancelStop dismisses it without stopping`() = runTest {
        val repository = FakeEnvironmentRepository()
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.requestStop()
        assertTrue(viewModel.state.value.isShowingStopConfirm)

        viewModel.cancelStop()
        runCurrent()

        assertFalse(viewModel.state.value.isShowingStopConfirm)
        assertEquals(0, repository.stopCallCount)
    }

    @Test
    fun `stop calls stopEnv and dismisses confirm while refreshing status`() = runTest {
        val repository = FakeEnvironmentRepository()
        repository.statusQueue.addAll(
            listOf(
                Result.success(EnvStatus(phase = EnvPhase.RUNNING)),
                Result.success(EnvStatus(phase = EnvPhase.IDLE)),
            ),
        )
        val viewModel = viewModel(repository)
        runCurrent()
        viewModel.requestStop()

        viewModel.stop()
        runCurrent()

        assertEquals(1, repository.stopCallCount)
        assertFalse(viewModel.state.value.isShowingStopConfirm)
        assertEquals(EnvPhase.IDLE, viewModel.state.value.status?.phase)
    }

    @Test
    fun `cancel calls cancelEnv and refreshes status`() = runTest {
        val repository = FakeEnvironmentRepository()
        repository.statusQueue.addAll(
            listOf(
                Result.success(EnvStatus(phase = EnvPhase.STARTING)),
                Result.success(EnvStatus(phase = EnvPhase.ERROR, message = "Cancelled")),
            ),
        )
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.cancel()
        runCurrent()

        assertEquals(1, repository.cancelCallCount)
        assertEquals(EnvPhase.ERROR, viewModel.state.value.status?.phase)
    }

    @Test
    fun `cancel failure surfaces an error message`() = runTest {
        val repository = FakeEnvironmentRepository()
        repository.cancelError = RuntimeException("not currently starting")
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.cancel()
        runCurrent()

        assertEquals("not currently starting", viewModel.state.value.errorMessage)
    }

    @Test
    fun `showLogs sets the selected service -- switchLogsService changes it -- hideLogs clears it`() = runTest {
        val repository = FakeEnvironmentRepository()
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.showLogs("web")
        assertEquals("web", viewModel.state.value.logsService)

        viewModel.switchLogsService("worker")
        assertEquals("worker", viewModel.state.value.logsService)

        viewModel.hideLogs()
        assertNull(viewModel.state.value.logsService)
    }

    @Test
    fun `dismissError clears error message`() = runTest {
        val repository = FakeEnvironmentRepository().apply { startError = ApiError.Server(500, "boom") }
        val viewModel = viewModel(repository)
        runCurrent()
        viewModel.setup()
        runCurrent()

        viewModel.dismissError()

        assertNull(viewModel.state.value.errorMessage)
    }
}
