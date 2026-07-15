package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.local.BaseUrlStore
import com.tanyudii.tmuxweb.data.local.TokenStore
import com.tanyudii.tmuxweb.domain.model.ConnectionSettings
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * jvmTest-only, not commonTest: this exercises DefaultConnectionSettingsStore's
 * save/load/clear delegation logic against the real TokenStore/BaseUrlStore
 * actuals for this target. On iOS those actuals hit the real Keychain, which
 * doesn't reliably round-trip inside the iosSimulatorArm64Test sandbox (no
 * app-bundle entitlements) — the jvmMain actuals are a deterministic
 * in-memory implementation built for exactly this kind of test, so this
 * verifies the store's coordination logic without depending on Keychain
 * behavior that's already covered by manual on-device QA.
 */
class ConnectionSettingsStoreTest {
    private fun store(): ConnectionSettingsStore = DefaultConnectionSettingsStore(TokenStore(), BaseUrlStore())

    @Test
    fun `load returns null when nothing has been saved`() = runTest {
        assertNull(store().load())
    }

    @Test
    fun `save then load round-trips the base URL and token`() = runTest {
        val store = store()

        store.save("http://host:5309", "secret-token")

        assertEquals(ConnectionSettings("http://host:5309", "secret-token"), store.load())
    }

    @Test
    fun `save overwrites a previously saved value`() = runTest {
        val store = store()
        store.save("http://old-host:5309", "old-token")

        store.save("http://new-host:5309", "new-token")

        assertEquals(ConnectionSettings("http://new-host:5309", "new-token"), store.load())
    }

    @Test
    fun `clear removes both the base URL and token`() = runTest {
        val store = store()
        store.save("http://host:5309", "secret-token")

        store.clear()

        assertNull(store.load())
    }

    @Test
    fun `load returns null when only the base URL was saved`() = runTest {
        val tokenStore = TokenStore()
        val baseUrlStore = BaseUrlStore()
        baseUrlStore.saveBaseUrl("http://host:5309")

        assertNull(DefaultConnectionSettingsStore(tokenStore, baseUrlStore).load())
    }

    @Test
    fun `load returns null when only the token was saved`() = runTest {
        val tokenStore = TokenStore()
        val baseUrlStore = BaseUrlStore()
        tokenStore.saveToken("secret-token")

        assertNull(DefaultConnectionSettingsStore(tokenStore, baseUrlStore).load())
    }
}
