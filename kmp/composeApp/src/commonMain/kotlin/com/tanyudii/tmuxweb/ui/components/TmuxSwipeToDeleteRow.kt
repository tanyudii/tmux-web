package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons

/**
 * Swipe-left-to-delete wrapper for a project/session [TmuxListRow] — the
 * handoff's iOS/Android kits both call this out in copy ("Swipe a row left
 * to delete"). [onDelete] fires as soon as the swipe crosses its threshold;
 * the swipe itself never completes (`confirmValueChange` returns `false`,
 * snapping the row back) since actual removal is driven by the caller's
 * ViewModel updating its list — which already owns the force-delete-confirm
 * escalation via [TmuxConfirmDialog], not this gesture.
 *
 * `confirmValueChange` is deprecated upstream with no replacement for this
 * exact veto-a-swipe use case (the suggested dynamic-anchors approach
 * doesn't fit "trigger a side effect, then always snap back") — accepted
 * until Compose ships one.
 *
 * [content] is wrapped in an opaque [TmuxColors.bgCard] backdrop rather
 * than trusting the caller's own row background: [TmuxListRow] is
 * transparent at rest by design (it normally just inherits whatever
 * background its parent [TmuxGroup]/list already painted), but
 * `SwipeToDismissBox` always composes its red `backgroundContent`
 * underneath at full size — a transparent foreground would let that red
 * bleed through even when not swiping. Found via live browser verification,
 * not visible from source alone.
 *
 * A real drag (also only caught via live verification, not a plain click)
 * re-evaluates `confirmValueChange` several times per gesture as the drag
 * settles back after being vetoed — without the [hasFired] guard below,
 * [onDelete] (and therefore the caller's delete API call) would fire once
 * per re-evaluation instead of once per swipe.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("DEPRECATION")
@Composable
fun TmuxSwipeToDeleteRow(onDelete: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    var hasFired by remember { mutableStateOf(false) }
    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart && !hasFired) {
                hasFired = true
                onDelete()
            }
            false
        },
    )
    LaunchedEffect(dismissState.currentValue) {
        if (dismissState.currentValue == SwipeToDismissBoxValue.Settled) hasFired = false
    }
    SwipeToDismissBox(
        state = dismissState,
        modifier = modifier,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            Box(
                modifier = Modifier.fillMaxSize().background(TmuxColors.red500).padding(horizontal = 20.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Icon(TmuxIcons.Trash, contentDescription = null, tint = TmuxColors.textPrimary)
            }
        },
        content = { Box(modifier = Modifier.background(TmuxColors.bgCard)) { content() } },
    )
}
