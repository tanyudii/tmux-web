package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

/**
 * Modal for destructive confirmation (delete project/session) — ports
 * `components/feedback/ConfirmDialog.jsx`. [force] renders the escalated
 * "active sessions will be killed" state.
 */
@Composable
fun TmuxConfirmDialog(
    title: String,
    message: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    force: Boolean = false,
    confirmLabel: String = "Delete",
    cancelLabel: String = "Cancel",
) {
    Dialog(onDismissRequest = onCancel) {
        Column(
            modifier = modifier
                .width(360.dp)
                .background(TmuxColors.bgCard, RoundedCornerShape(TmuxRadius.lg))
                .padding(20.dp),
        ) {
            ConfirmDialogHeader(title = title, force = force)
            Text(
                message,
                color = TmuxColors.textSecondary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.sm,
                modifier = Modifier.padding(top = 12.dp),
            )
            if (force) {
                ForceWarningBanner()
            }
            ConfirmDialogFooter(
                force = force,
                confirmLabel = confirmLabel,
                cancelLabel = cancelLabel,
                onConfirm = onConfirm,
                onCancel = onCancel,
            )
        }
    }
}

/** Icon-badge + title row, escalated to the amber "force" tone when [force] is set. */
@Composable
private fun ConfirmDialogHeader(title: String, force: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(32.dp)
                .background(if (force) TmuxColors.amberGlow else TmuxColors.redGlow, RoundedCornerShape(TmuxRadius.sm)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (force) TmuxIcons.Alert else TmuxIcons.Trash,
                contentDescription = null,
                tint = if (force) TmuxColors.amber500 else TmuxColors.red500,
                modifier = Modifier.size(18.dp),
            )
        }
        Text(
            title,
            color = TmuxColors.textPrimary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.md,
            fontWeight = TmuxWeight.semibold,
            modifier = Modifier.padding(start = 10.dp),
        )
    }
}

/** Escalated "active sessions will be killed" strip shown when [force] deletion is in play. */
@Composable
private fun ForceWarningBanner() {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 12.dp)
            .background(TmuxColors.amberGlow, RoundedCornerShape(TmuxRadius.sm))
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        Icon(TmuxIcons.Alert, contentDescription = null, tint = TmuxColors.amber500, modifier = Modifier.size(14.dp))
        Text(
            "Active sessions will be killed.",
            color = TmuxColors.amber500,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxTextSize.xs,
            modifier = Modifier.padding(start = 8.dp),
        )
    }
}

/** Cancel/confirm button pair; confirm switches to "Force delete" copy when [force] is set. */
@Composable
private fun ConfirmDialogFooter(
    force: Boolean,
    confirmLabel: String,
    cancelLabel: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
    ) {
        TmuxButton(
            onClick = onCancel,
            text = cancelLabel,
            variant = TmuxButtonVariant.SECONDARY,
            fillWidth = true,
            modifier = Modifier.weight(1f),
        )
        TmuxButton(
            onClick = onConfirm,
            text = if (force) "Force delete" else confirmLabel,
            variant = TmuxButtonVariant.DANGER,
            icon = TmuxIcons.Trash,
            fillWidth = true,
            modifier = Modifier.weight(1f),
        )
    }
}
