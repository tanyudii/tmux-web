package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize

/**
 * Dismissible top-of-screen error strip for ViewModel-level failures (load
 * failed, poll failed) that don't belong inside a specific dialog. Every
 * screen ViewModel already tracks an `errorMessage` field; this is the one
 * place that renders it.
 */
@Composable
fun TmuxErrorBanner(message: String, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .background(TmuxColors.redGlow)
            .padding(horizontal = 14.dp, vertical = 9.dp),
    ) {
        Text(
            message,
            color = TmuxColors.red500,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.sm,
            modifier = Modifier.weight(1f),
        )
        TmuxIconButton(
            icon = TmuxIcons.Close,
            contentDescription = "Dismiss",
            onClick = onDismiss,
            size = TmuxIconButtonSize.SM,
        )
    }
}
