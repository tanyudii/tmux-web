package com.tanyudii.tmuxweb.data.remote.terminal

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Wire protocol for the `/ws` terminal socket, mirroring `ClientMessage`/
 * `parseClientMessage` in src/pty-bridge.ts exactly:
 *   { "type": "input", "data": string }
 *   { "type": "resize", "cols": number, "rows": number }
 *   { "type": "scroll", "direction": "up"|"down", "lines": number }
 *
 * The server never sends JSON back over this socket — output is raw PTY
 * bytes fed straight to the terminal widget. This type only needs to encode
 * client -> server, but stays decodable for tests that mirror
 * pty-bridge.test.ts's coverage of the server-side parser.
 */
sealed class ClientMessage {
    data class Input(val data: String) : ClientMessage()

    data class Resize(val cols: Int, val rows: Int) : ClientMessage()

    data class Scroll(val direction: ScrollDirection, val lines: Int) : ClientMessage()

    enum class ScrollDirection {
        UP,
        DOWN,
        ;

        val wireValue: String get() = if (this == UP) "up" else "down"
    }

    fun encode(): String = buildJsonObject {
        when (this@ClientMessage) {
            is Input -> {
                put("type", "input")
                put("data", data)
            }

            is Resize -> {
                put("type", "resize")
                put("cols", cols)
                put("rows", rows)
            }

            is Scroll -> {
                put("type", "scroll")
                put("direction", direction.wireValue)
                put("lines", lines)
            }
        }
    }.toString()

    companion object {
        /**
         * Mirrors the validation `parseClientMessage` performs server-side:
         * `resize`/`scroll` require positive integers, `input` requires a
         * string `data` field, unknown/malformed input returns null (the
         * server silently ignores it rather than erroring).
         */
        fun decode(raw: String): ClientMessage? {
            val obj = (runCatching { Json.parseToJsonElement(raw) }.getOrNull() as? JsonObject) ?: return null
            return when (obj["type"]?.jsonPrimitive?.contentOrNull) {
                "input" -> decodeInput(obj)
                "resize" -> decodeResize(obj)
                "scroll" -> decodeScroll(obj)
                else -> null
            }
        }

        private fun decodeInput(obj: JsonObject): Input? {
            val data = obj["data"]?.jsonPrimitive?.contentOrNull ?: return null
            return Input(data)
        }

        private fun decodeResize(obj: JsonObject): Resize? {
            val cols = obj["cols"]?.jsonPrimitive?.intOrNull ?: return null
            val rows = obj["rows"]?.jsonPrimitive?.intOrNull ?: return null
            if (cols <= 0 || rows <= 0) return null
            return Resize(cols, rows)
        }

        private fun decodeScroll(obj: JsonObject): Scroll? {
            val direction = parseScrollDirection(obj["direction"]?.jsonPrimitive?.contentOrNull) ?: return null
            val lines = obj["lines"]?.jsonPrimitive?.intOrNull ?: return null
            if (lines <= 0) return null
            return Scroll(direction, lines)
        }

        private fun parseScrollDirection(value: String?): ScrollDirection? = when (value) {
            "up" -> ScrollDirection.UP
            "down" -> ScrollDirection.DOWN
            else -> null
        }
    }
}
