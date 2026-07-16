package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.tanyudii.tmuxweb.domain.model.ComposeServiceStatus
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import kotlinx.coroutines.launch

private const val DIALOG_WIDTH_FRACTION = 0.85f
private const val DIALOG_HEIGHT_FRACTION = 0.85f
private const val BOTTOM_PROXIMITY_ITEMS = 2

/**
 * Same status->color mapping as [ServiceRow]'s private `dotColor` --
 * duplicated rather than made public across files for one small helper.
 */
private fun serviceDotColor(state: String): Color = when (state.lowercase()) {
    "running" -> TmuxColors.statusConnected
    "starting" -> TmuxColors.statusReconnecting
    "error" -> TmuxColors.statusDisconnected
    else -> TmuxColors.statusIdle
}

/**
 * Live docker-compose service logs popup, opened from a service row's logs
 * icon ([TmuxEnvironmentMenu]'s `ServiceRow`). Lets the user switch which
 * service's logs stream without closing the popup, and auto-scrolls to new
 * output only while already near the bottom. Ports [TmuxDiffDialog]'s
 * structural shape (same Dialog sizing/background/radius) -- a dumb
 * composable, all state comes from the caller's [com.tanyudii.tmuxweb.presentation.LogsViewModel].
 */
@Composable
fun TmuxLogsDialog(
    selectedService: String,
    services: List<ComposeServiceStatus>,
    lines: List<String>,
    isConnected: Boolean,
    onDismiss: () -> Unit,
    onSwitchService: (String) -> Unit,
) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            modifier = Modifier
                .fillMaxWidth(DIALOG_WIDTH_FRACTION)
                .fillMaxHeight(DIALOG_HEIGHT_FRACTION)
                .background(TmuxColors.bgCard, RoundedCornerShape(TmuxRadius.lg)),
        ) {
            LogsDialogHeader(selectedService, services, isConnected, onDismiss, onSwitchService)
            LogsDialogBody(lines = lines, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun LogsDialogHeader(
    selectedService: String,
    services: List<ComposeServiceStatus>,
    isConnected: Boolean,
    onDismiss: () -> Unit,
    onSwitchService: (String) -> Unit,
) {
    var switcherOpen by remember { mutableStateOf(false) }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 16.dp),
    ) {
        TmuxIconButton(
            icon = TmuxIcons.Close,
            contentDescription = "Close logs",
            onClick = onDismiss,
            size = TmuxIconButtonSize.SM,
        )
        Box(modifier = Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.clickable { switcherOpen = !switcherOpen },
            ) {
                Text(
                    "Logs: $selectedService",
                    color = TmuxColors.textPrimary,
                    fontFamily = TmuxFonts.mono,
                    fontSize = TmuxTextSize.sm,
                )
                Icon(
                    TmuxIcons.ChevronDown,
                    contentDescription = null,
                    tint = TmuxColors.textTertiary,
                    modifier = Modifier.size(16.dp).padding(start = 2.dp),
                )
            }
            LogsServiceSwitcherMenu(
                expanded = switcherOpen,
                services = services,
                onDismiss = { switcherOpen = false },
                onSwitchService = { service ->
                    switcherOpen = false
                    onSwitchService(service)
                },
            )
        }
        TmuxStatusBadge(
            text = if (isConnected) "live" else "disconnected",
            tone = if (isConnected) TmuxStatusTone.CONNECTED else TmuxStatusTone.DISCONNECTED,
            dot = true,
            pulse = isConnected,
        )
    }
}

@Composable
private fun LogsServiceSwitcherMenu(
    expanded: Boolean,
    services: List<ComposeServiceStatus>,
    onDismiss: () -> Unit,
    onSwitchService: (String) -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss, modifier = Modifier.background(TmuxColors.bgCard)) {
        services.forEach { service ->
            DropdownMenuItem(
                text = {
                    Text(
                        service.service,
                        color = TmuxColors.textPrimary,
                        fontFamily = TmuxFonts.mono,
                        fontSize = TmuxTextSize.sm,
                    )
                },
                leadingIcon = { Box(Modifier.size(7.dp).background(serviceDotColor(service.state), CircleShape)) },
                onClick = { onSwitchService(service.service) },
            )
        }
    }
}

@Composable
private fun LogsDialogBody(lines: List<String>, modifier: Modifier = Modifier) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    val lastVisibleIndex = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index
    val isNearBottom = lines.isEmpty() || lastVisibleIndex == null ||
        lastVisibleIndex >= lines.lastIndex - BOTTOM_PROXIMITY_ITEMS

    LaunchedEffect(lines.size) {
        if (lines.isNotEmpty() && isNearBottom) {
            listState.animateScrollToItem(lines.lastIndex)
        }
    }

    Box(modifier = modifier.fillMaxWidth()) {
        LazyColumn(state = listState, modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
            items(lines) { line ->
                Text(
                    line,
                    fontFamily = TmuxFonts.mono,
                    fontSize = TmuxTextSize.xs,
                    color = TmuxColors.textSecondary,
                )
            }
        }
        if (!isNearBottom && lines.isNotEmpty()) {
            TmuxIconButton(
                icon = TmuxIcons.ChevronDown,
                contentDescription = "Jump to latest",
                onClick = { scope.launch { listState.animateScrollToItem(lines.lastIndex) } },
                variant = TmuxIconButtonVariant.FILLED,
                modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp),
            )
        }
    }
}
