package com.tanyudii.tmuxweb

import kotlin.test.Test
import kotlin.test.assertEquals

class ScaffoldSmokeTest {
    @Test
    fun `commonTest source set is wired correctly`() {
        // Arrange
        val expected = 2

        // Act
        val actual = 1 + 1

        // Assert
        assertEquals(expected, actual)
    }
}
