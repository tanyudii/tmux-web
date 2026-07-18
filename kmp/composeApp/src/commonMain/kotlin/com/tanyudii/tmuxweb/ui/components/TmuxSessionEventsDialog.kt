package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.tanyudii.tmuxweb.domain.model.SessionEvent
import com.tanyudii.tmuxweb.presentation.SessionEventsUiState
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

/**
 * Read-only lifecycle timeline for a single session (create -> env setup ->
 * env stop -> delete) -- EMB-213. Answers "why is this session like this"
 * from the UI instead of raw server logs.
 */
@Composable
fun TmuxSessionEventsDialog(
    sessionName: String,
    state: SessionEventsUiState,
    onRefresh: () -> Unit,
    onDismiss: () -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier.width(420.dp).background(TmuxColors.bgCard, RoundedCornerShape(TmuxRadius.lg))
                .padding(20.dp),
        ) {
            Text(
                "Event history · $sessionName",
                color = TmuxColors.textPrimary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.md,
                fontWeight = TmuxWeight.semibold,
            )
            when {
                state.isLoading -> TmuxProgressBar(label = "Loading…")
                state.errorMessage != null -> Text(
                    state.errorMessage,
                    color = TmuxColors.red500,
                    fontFamily = TmuxFonts.sans,
                    fontSize = TmuxTextSize.sm,
                    modifier = Modifier.padding(top = 12.dp),
                )
                state.events.isEmpty() -> Text(
                    "No events recorded yet.",
                    color = TmuxColors.textTertiary,
                    fontFamily = TmuxFonts.sans,
                    fontSize = TmuxTextSize.sm,
                    modifier = Modifier.padding(top = 12.dp),
                )
                else -> LazyColumn(modifier = Modifier.heightIn(max = 320.dp).padding(top = 12.dp)) {
                    items(state.events, key = { "${it.timestamp}-${it.type}" }) { event -> SessionEventRow(event) }
                }
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            ) {
                TmuxButton(
                    onClick = onRefresh,
                    text = "Refresh",
                    variant = TmuxButtonVariant.GHOST,
                    fillWidth = true,
                    modifier = Modifier.weight(1f),
                )
                TmuxButton(
                    onClick = onDismiss,
                    text = "Close",
                    variant = TmuxButtonVariant.PRIMARY,
                    fillWidth = true,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun SessionEventRow(event: SessionEvent) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                event.timestamp,
                color = TmuxColors.textSecondary,
                fontFamily = TmuxFonts.mono,
                fontSize = TmuxTextSize.xs,
            )
            Text(
                event.type,
                color = if (event.type == "env_setup_failed") TmuxColors.red500 else TmuxColors.accent,
                fontFamily = TmuxFonts.mono,
                fontSize = TmuxTextSize.xs,
                fontWeight = TmuxWeight.semibold,
            )
        }
        event.message?.let {
            Text(it, color = TmuxColors.textPrimary, fontFamily = TmuxFonts.mono, fontSize = TmuxTextSize.sm)
        }
    }
}
