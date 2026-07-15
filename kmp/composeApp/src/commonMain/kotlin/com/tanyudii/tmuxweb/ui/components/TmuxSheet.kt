package com.tanyudii.tmuxweb.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxMotion
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

/** One-off corner radius — the handoff hardcodes 14px here, distinct from the `xl` (16dp) token used by [TmuxGroup]. */
private val SHEET_CORNER_RADIUS = 14.dp
private const val SLIDE_DURATION_MS = 320

/**
 * iOS bottom form sheet — ports `ui_kits/ios/chrome.jsx`'s `Sheet`. Scrim +
 * slide-up sheet with a Cancel/title/Action header row, matching the
 * handoff's New Project / New Session forms. Only animates on entry (the
 * source component itself has no exit animation — it just unmounts), so
 * callers mount this conditionally (`if (state != null) TmuxSheet(...)`),
 * same pattern as [TmuxConfirmDialog].
 */
@Composable
fun TmuxSheet(
    title: String,
    actionLabel: String,
    onDismiss: () -> Unit,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
    actionEnabled: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(TmuxColors.scrim)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onDismiss,
                ),
            contentAlignment = Alignment.BottomCenter,
        ) {
            var visible by remember { mutableStateOf(false) }
            LaunchedEffect(Unit) { visible = true }
            AnimatedVisibility(
                visible = visible,
                enter = slideInVertically(
                    animationSpec = tween(SLIDE_DURATION_MS, easing = TmuxMotion.easeIos),
                    initialOffsetY = { fullHeight -> fullHeight },
                ),
                exit = ExitTransition.None,
            ) {
                SheetContent(title, actionLabel, onDismiss, onAction, actionEnabled, modifier, content)
            }
        }
    }
}

@Composable
private fun SheetContent(
    title: String,
    actionLabel: String,
    onDismiss: () -> Unit,
    onAction: () -> Unit,
    actionEnabled: Boolean,
    modifier: Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = {},
            )
            .background(
                TmuxColors.bgSurface,
                RoundedCornerShape(topStart = SHEET_CORNER_RADIUS, topEnd = SHEET_CORNER_RADIUS),
            )
            .border(
                1.dp,
                TmuxColors.borderDefault,
                RoundedCornerShape(topStart = SHEET_CORNER_RADIUS, topEnd = SHEET_CORNER_RADIUS),
            ),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 8.dp),
        ) {
            Text(
                "Cancel",
                color = TmuxColors.accent,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.md,
                modifier = Modifier.clickable(onClick = onDismiss),
            )
            Text(
                title,
                color = TmuxColors.textPrimary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.md,
                fontWeight = TmuxWeight.semibold,
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.Center,
            )
            Text(
                actionLabel,
                color = if (actionEnabled) TmuxColors.accent else TmuxColors.textDisabled,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.md,
                fontWeight = TmuxWeight.semibold,
                modifier = Modifier.clickable(enabled = actionEnabled, onClick = onAction),
            )
        }
        Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 28.dp), content = content)
    }
}
