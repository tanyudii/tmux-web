package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.domain.model.PushSubscriptionKeys
import com.tanyudii.tmuxweb.domain.model.PushSubscriptionPayload
import com.tanyudii.tmuxweb.presentation.fakes.FakePushNotificationRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val SUBSCRIPTION = PushSubscriptionPayload("https://push.example.com/a", PushSubscriptionKeys("p", "a"))

class PushNotificationViewModelTest {
    private fun viewModel(
        repository: FakePushNotificationRepository = FakePushNotificationRepository(),
        isBrowserPushSupported: () -> Boolean = { true },
        subscribeBrowserPush: suspend (String) -> PushSubscriptionPayload? = { SUBSCRIPTION },
        unsubscribeBrowserPush: suspend () -> String? = { SUBSCRIPTION.endpoint },
        currentBrowserPushEndpoint: suspend () -> String? = { null },
    ): PushNotificationViewModel {
        val scope = CoroutineScope(UnconfinedTestDispatcher())
        return PushNotificationViewModel(
            repository,
            scope,
            isBrowserPushSupported,
            subscribeBrowserPush,
            unsubscribeBrowserPush,
            currentBrowserPushEndpoint,
        )
    }

    @Test
    fun `isSupported reflects isBrowserPushSupported at construction`() = runTest {
        val state = viewModel(isBrowserPushSupported = { false }).state.value
        assertFalse(state.isSupported)
    }

    @Test
    fun `isEnabled starts true when a subscription already exists on this device`() = runTest {
        val state = viewModel(currentBrowserPushEndpoint = { SUBSCRIPTION.endpoint }).state.value
        assertTrue(state.isEnabled)
    }

    @Test
    fun `isEnabled starts false when there is no existing subscription`() = runTest {
        val state = viewModel(currentBrowserPushEndpoint = { null }).state.value
        assertFalse(state.isEnabled)
    }

    @Test
    fun `toggle when off subscribes via the browser then registers with the backend`() = runTest {
        val repository = FakePushNotificationRepository()
        val viewModel = viewModel(repository = repository, currentBrowserPushEndpoint = { null })

        viewModel.toggle()

        assertEquals(listOf(SUBSCRIPTION), repository.subscribeCalls)
        assertTrue(viewModel.state.value.isEnabled)
        assertFalse(viewModel.state.value.isBusy)
        assertNull(viewModel.state.value.errorMessage)
    }

    @Test
    fun `toggle when off surfaces an error when the browser declines to subscribe`() = runTest {
        val viewModel = viewModel(subscribeBrowserPush = { null }, currentBrowserPushEndpoint = { null })

        viewModel.toggle()

        assertFalse(viewModel.state.value.isEnabled)
        assertFalse(viewModel.state.value.isBusy)
        assertEquals(
            "Push notifications weren't enabled -- check your browser's notification permission.",
            viewModel.state.value.errorMessage,
        )
    }

    @Test
    fun `toggle when off surfaces an error when the backend subscribe call fails`() = runTest {
        val repository = FakePushNotificationRepository().apply { subscribeError = RuntimeException("network down") }
        val viewModel = viewModel(repository = repository, currentBrowserPushEndpoint = { null })

        viewModel.toggle()

        assertFalse(viewModel.state.value.isEnabled)
        assertEquals("network down", viewModel.state.value.errorMessage)
    }

    @Test
    fun `toggle when on unsubscribes via the browser then unregisters with the backend`() = runTest {
        val repository = FakePushNotificationRepository()
        val viewModel = viewModel(repository = repository, currentBrowserPushEndpoint = { SUBSCRIPTION.endpoint })

        viewModel.toggle()

        assertEquals(listOf(SUBSCRIPTION.endpoint), repository.unsubscribeCalls)
        assertFalse(viewModel.state.value.isEnabled)
        assertFalse(viewModel.state.value.isBusy)
    }

    @Test
    fun `toggle when on does not call backend unsubscribe when the browser had nothing to unsubscribe`() = runTest {
        val repository = FakePushNotificationRepository()
        val viewModel = viewModel(
            repository = repository,
            unsubscribeBrowserPush = { null },
            currentBrowserPushEndpoint = { SUBSCRIPTION.endpoint },
        )

        viewModel.toggle()

        assertTrue(repository.unsubscribeCalls.isEmpty())
        assertFalse(viewModel.state.value.isEnabled)
    }
}
