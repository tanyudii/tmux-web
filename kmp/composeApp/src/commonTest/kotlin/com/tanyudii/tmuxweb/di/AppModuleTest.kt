package com.tanyudii.tmuxweb.di

import org.koin.core.context.stopKoin
import kotlin.test.AfterTest
import kotlin.test.Test

class AppModuleTest {
    @AfterTest
    fun tearDown() {
        stopKoin()
    }

    @Test
    fun `initKoin starts without throwing when given no platform module`() {
        // Arrange / Act
        initKoin()

        // Assert: reaching this line without an exception is the assertion —
        // Koin's own startKoin() throws on a broken module graph.
    }
}
