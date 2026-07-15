package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.data.remote.ConnectionTester
import com.tanyudii.tmuxweb.domain.model.ConnectionSettings
import com.tanyudii.tmuxweb.presentation.fakes.FakeConnectionSettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Ports ConnectionSettingsView.swift's URL validation + test-connection-then-save flow. */
class ConnectionSettingsViewModelTest {
    private fun viewModel(
        store: FakeConnectionSettingsStore = FakeConnectionSettingsStore(),
        tester: ConnectionTester = ConnectionTester { _, _ -> },
    ): ConnectionSettingsViewModel {
        val scope = CoroutineScope(UnconfinedTestDispatcher())
        return ConnectionSettingsViewModel(store, tester, scope)
    }

    @Test
    fun `loads existing settings on init`() = runTest {
        val store = FakeConnectionSettingsStore(ConnectionSettings("http://host:5309", "secret"))

        val state = viewModel(store).state.value

        assertEquals(ConnectionSettings("http://host:5309", "secret"), state.current)
    }

    @Test
    fun `isLoaded is true after init resolves`() = runTest {
        val state = viewModel().state.value

        assertTrue(state.isLoaded)
    }

    @Test
    fun `invalid server URL surfaces an error without calling the tester`() = runTest {
        var testerCalled = false
        val viewModel = viewModel(tester = ConnectionTester { _, _ -> testerCalled = true })
        viewModel.updateServerUrlText("not-a-url")
        viewModel.updateToken("secret")

        viewModel.testAndSave()

        assertEquals("Invalid server URL.", viewModel.state.value.errorMessage)
        assertFalse(testerCalled)
    }

    @Test
    fun `successful test saves settings and clears testing flag`() = runTest {
        val store = FakeConnectionSettingsStore()
        val viewModel = viewModel(store = store)
        viewModel.updateServerUrlText("http://host:5309")
        viewModel.updateToken("secret")

        viewModel.testAndSave()

        val state = viewModel.state.value
        assertFalse(state.isTesting)
        assertNull(state.errorMessage)
        assertEquals(ConnectionSettings("http://host:5309", "secret"), state.current)
        assertEquals(1, store.saveCallCount)
    }

    @Test
    fun `failed test surfaces error and does not save`() = runTest {
        val store = FakeConnectionSettingsStore()
        val viewModel = viewModel(
            store = store,
            tester = ConnectionTester { _, _ -> throw ApiError.Unauthorized },
        )
        viewModel.updateServerUrlText("http://host:5309")
        viewModel.updateToken("wrong-token")

        viewModel.testAndSave()

        val state = viewModel.state.value
        assertFalse(state.isTesting)
        assertEquals(ApiError.Unauthorized.message, state.errorMessage)
        assertNull(state.current)
        assertEquals(0, store.saveCallCount)
    }

    @Test
    fun `clear resets state and delegates to the store`() = runTest {
        val store = FakeConnectionSettingsStore(ConnectionSettings("http://host:5309", "secret"))
        val viewModel = viewModel(store = store)

        viewModel.clear()

        assertEquals(1, store.clearCallCount)
        assertNull(viewModel.state.value.current)
        assertEquals("http://", viewModel.state.value.serverUrlText)
        assertTrue(viewModel.state.value.isLoaded)
    }

    @Test
    fun `canSubmit is false while testing or with empty fields`() = runTest {
        val viewModel = viewModel(tester = ConnectionTester { _, _ -> })

        assertFalse(viewModel.state.value.canSubmit)

        viewModel.updateServerUrlText("http://host:5309")
        viewModel.updateToken("secret")

        assertTrue(viewModel.state.value.canSubmit)
    }
}
