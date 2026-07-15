package com.tanyudii.tmuxweb.di

import com.tanyudii.tmuxweb.domain.model.ConnectionSettings
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class TmuxWebSessionHolderTest {
    @Test
    fun `require throws before update is called`() {
        // Arrange
        val holder = TmuxWebSessionHolder()

        // Act / Assert
        assertFailsWith<IllegalStateException> { holder.require() }
    }

    @Test
    fun `require returns the settings passed to update`() {
        // Arrange
        val holder = TmuxWebSessionHolder()
        val settings = ConnectionSettings("http://host:5309", "token")

        // Act
        holder.update(settings)

        // Assert
        assertEquals(settings, holder.require())
    }

    @Test
    fun `require throws again after update is called with null`() {
        // Arrange
        val holder = TmuxWebSessionHolder()
        holder.update(ConnectionSettings("http://host:5309", "token"))

        // Act
        holder.update(null)

        // Assert
        assertFailsWith<IllegalStateException> { holder.require() }
    }
}
