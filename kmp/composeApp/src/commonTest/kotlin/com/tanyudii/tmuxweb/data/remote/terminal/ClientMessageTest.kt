package com.tanyudii.tmuxweb.data.remote.terminal

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Ports ios/TmuxWebClientTests/ClientMessageTests.swift's coverage of
 * src/pty-bridge.ts's `parseClientMessage` 1:1 — same JSON fixtures, same
 * edge cases (zero/negative resize dimensions, malformed JSON, unknown type).
 */
class ClientMessageTest {
    @Test
    fun `encode input produces expected JSON`() {
        // Arrange
        val message = ClientMessage.Input("ls\n")

        // Act
        val obj = Json.parseToJsonElement(message.encode()).jsonObject

        // Assert
        assertEquals("input", obj["type"]?.jsonPrimitive?.contentOrNull)
        assertEquals("ls\n", obj["data"]?.jsonPrimitive?.contentOrNull)
    }

    @Test
    fun `encode resize produces expected JSON`() {
        // Arrange
        val message = ClientMessage.Resize(cols = 100, rows = 40)

        // Act
        val obj = Json.parseToJsonElement(message.encode()).jsonObject

        // Assert
        assertEquals("resize", obj["type"]?.jsonPrimitive?.contentOrNull)
        assertEquals(100, obj["cols"]?.jsonPrimitive?.int)
        assertEquals(40, obj["rows"]?.jsonPrimitive?.int)
    }

    @Test
    fun `decode valid input message`() {
        assertEquals(ClientMessage.Input("ls\n"), ClientMessage.decode("""{"type":"input","data":"ls\n"}"""))
    }

    @Test
    fun `decode valid resize message`() {
        assertEquals(
            ClientMessage.Resize(cols = 100, rows = 40),
            ClientMessage.decode("""{"type":"resize","cols":100,"rows":40}"""),
        )
    }

    @Test
    fun `decode malformed JSON returns null`() {
        assertNull(ClientMessage.decode("not json"))
    }

    @Test
    fun `decode unknown type returns null`() {
        assertNull(ClientMessage.decode("""{"type":"eval","data":"rm -rf /"}"""))
    }

    @Test
    fun `decode missing input data returns null`() {
        assertNull(ClientMessage.decode("""{"type":"input"}"""))
    }

    @Test
    fun `decode zero or negative resize dimensions returns null`() {
        assertNull(ClientMessage.decode("""{"type":"resize","cols":0,"rows":24}"""))
        assertNull(ClientMessage.decode("""{"type":"resize","cols":80,"rows":-1}"""))
    }

    @Test
    fun `encode then decode round trips`() {
        // Arrange
        val original = ClientMessage.Input("echo hi")

        // Act
        val decoded = ClientMessage.decode(original.encode())

        // Assert
        assertEquals(original, decoded)
    }

    @Test
    fun `decode scroll message`() {
        assertEquals(
            ClientMessage.Scroll(ClientMessage.ScrollDirection.UP, lines = 3),
            ClientMessage.decode("""{"type":"scroll","direction":"up","lines":3}"""),
        )
    }

    @Test
    fun `decode scroll with zero or negative lines returns null`() {
        assertNull(ClientMessage.decode("""{"type":"scroll","direction":"up","lines":0}"""))
    }
}
