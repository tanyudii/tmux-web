package com.tanyudii.tmuxweb.ui.terminal

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

// Control codes spelled out via Char(decimal) rather than \u-escapes or
// literal bytes in the source — keeps these unambiguous across editors/diff
// tools instead of relying on an invisible raw control byte in the file.
private const val ASCII_ESCAPE = 27
private const val ASCII_ETX = 3
private const val ASCII_STX = 2
private const val ASCII_EOT = 4

/** Mobile-only, screen-size gated per plan §2.6 — a direct port of QuickKeysBar.swift. */
private val QUICK_KEYS = listOf(
    "Esc" to Char(ASCII_ESCAPE).toString(),
    "Tab" to "\t",
    "^C" to Char(ASCII_ETX).toString(),
    "^B" to Char(ASCII_STX).toString(),
    "^D" to Char(ASCII_EOT).toString(),
)

private val NARROW_WIDTH_THRESHOLD = 600.dp

@Composable
fun QuickKeysBar(onKeyTap: (String) -> Unit) {
    BoxWithConstraints {
        if (maxWidth >= NARROW_WIDTH_THRESHOLD) return@BoxWithConstraints

        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            QUICK_KEYS.forEach { (label, sequence) ->
                Surface(
                    onClick = { onKeyTap(sequence) },
                    tonalElevation = 2.dp,
                    shape = MaterialTheme.shapes.small,
                ) {
                    Text(label, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                }
            }
        }
    }
}
