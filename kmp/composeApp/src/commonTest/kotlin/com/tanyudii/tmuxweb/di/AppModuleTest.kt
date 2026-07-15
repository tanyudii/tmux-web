package com.tanyudii.tmuxweb.di

import com.tanyudii.tmuxweb.domain.model.ConnectionSettings
import com.tanyudii.tmuxweb.domain.repository.ProjectsRepository
import org.koin.core.context.stopKoin
import org.koin.core.error.InstanceCreationException
import org.koin.mp.KoinPlatform
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull

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

    @Test
    fun `resolving ProjectsRepository before connection settings are set throws`() {
        // Arrange
        initKoin()

        // Act
        val exception = assertFailsWith<InstanceCreationException> { KoinPlatform.getKoin().get<ProjectsRepository>() }

        // Assert: Koin wraps the factory lambda's failure — the root cause is
        // TmuxWebSessionHolder.require()'s IllegalStateException.
        assertIs<IllegalStateException>(generateSequence<Throwable>(exception) { it.cause }.last())
    }

    @Test
    fun `resolving ProjectsRepository succeeds once TmuxWebSessionHolder is updated`() {
        // Arrange
        initKoin()
        KoinPlatform.getKoin().get<TmuxWebSessionHolder>().update(ConnectionSettings("http://host:5309", "token"))

        // Act
        val repository = KoinPlatform.getKoin().get<ProjectsRepository>()

        // Assert
        assertNotNull(repository)
    }
}
