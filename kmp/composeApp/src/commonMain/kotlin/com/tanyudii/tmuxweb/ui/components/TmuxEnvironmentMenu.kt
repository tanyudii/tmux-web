package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.domain.model.ComposeServiceStatus
import com.tanyudii.tmuxweb.domain.model.EnvPhase
import com.tanyudii.tmuxweb.domain.model.EnvStatus
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

private fun dotColor(state: String): Color = when (state.lowercase()) {
    "running" -> TmuxColors.statusConnected
    "starting" -> TmuxColors.statusReconnecting
    "error" -> TmuxColors.statusDisconnected
    else -> TmuxColors.statusIdle
}

/**
 * One toolbar control: click to run the session's docker-compose environment,
 * shows a "Setting up…" state, then becomes a dropdown of services once
 * running — ports `components/environment/EnvironmentMenu.jsx`. Renders
 * nothing when [status] is null/unavailable (projects without
 * `.tmux-web-env/` never show this control, per plan §5).
 */
@Composable
fun TmuxEnvironmentMenu(
    status: EnvStatus?,
    isBusy: Boolean,
    onRun: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (status == null || status.phase == EnvPhase.UNAVAILABLE) return
    var open by remember { mutableStateOf(false) }
    val running = status.phase == EnvPhase.RUNNING
    val starting = status.phase == EnvPhase.STARTING || (isBusy && status.phase == EnvPhase.IDLE)
    val services = status.services.orEmpty()
    val upCount = services.count { it.state.equals("running", ignoreCase = true) }
    val uriHandler = LocalUriHandler.current

    Box(modifier = modifier) {
        EnvironmentToggleRow(
            running = running,
            starting = starting,
            upCount = upCount,
            serviceCount = services.size,
            onToggleOpen = { open = !open },
            onRun = onRun,
        )
        EnvironmentDropdownContent(
            open = open,
            running = running,
            services = services,
            openUrl = status.openUrl,
            uriHandler = uriHandler,
            onDismiss = { open = false },
            onServiceOpened = { open = false },
            onStop = {
                open = false
                onStop()
            },
        )
    }
}

/**
 * Collapsed toolbar affordance: spinner while starting, otherwise the
 * box icon plus (once running) a live service count and chevron. Split out
 * of [TmuxEnvironmentMenu] purely to keep that composable's cyclomatic
 * complexity under the project's threshold — no behavior change.
 */
@Composable
private fun EnvironmentToggleRow(
    running: Boolean,
    starting: Boolean,
    upCount: Int,
    serviceCount: Int,
    onToggleOpen: () -> Unit,
    onRun: () -> Unit,
) {
    Row(
        modifier = Modifier
            .height(32.dp)
            .background(if (running) TmuxColors.bgRaised else Color.Transparent, RoundedCornerShape(TmuxRadius.sm))
            .border(
                1.dp,
                if (running) TmuxColors.borderDefault else Color.Transparent,
                RoundedCornerShape(TmuxRadius.sm),
            )
            .clickable(enabled = !starting) { if (running) onToggleOpen() else onRun() }
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when {
            starting -> SpinningIcon(TmuxIcons.Spinner, 16.dp, TmuxColors.statusReconnecting)
            else -> Icon(
                TmuxIcons.Box,
                contentDescription = "Environment",
                tint = if (running) TmuxColors.accent else TmuxColors.textSecondary,
                modifier = Modifier.size(16.dp),
            )
        }
        if (starting) {
            Text(
                "Setting up…",
                color = TmuxColors.statusReconnecting,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.sm,
                fontWeight = TmuxWeight.semibold,
                modifier = Modifier.padding(start = 7.dp),
            )
        }
        if (running) {
            Text(
                "$upCount/$serviceCount",
                color = TmuxColors.textPrimary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.sm,
                fontWeight = TmuxWeight.semibold,
                modifier = Modifier.padding(start = 7.dp),
            )
            Icon(
                TmuxIcons.ChevronDown,
                contentDescription = null,
                tint = TmuxColors.textTertiary,
                modifier = Modifier.size(14.dp).padding(start = 2.dp),
            )
        }
    }
}

/**
 * The services dropdown: header row, one [ServiceRow] per service, and the
 * stop-environment action. Split out of [TmuxEnvironmentMenu] purely to keep
 * that composable's cyclomatic complexity under the project's threshold —
 * no behavior change.
 */
@Composable
private fun EnvironmentDropdownContent(
    open: Boolean,
    running: Boolean,
    services: List<ComposeServiceStatus>,
    openUrl: String?,
    uriHandler: UriHandler,
    onDismiss: () -> Unit,
    onServiceOpened: () -> Unit,
    onStop: () -> Unit,
) {
    DropdownMenu(
        expanded = open && running,
        onDismissRequest = onDismiss,
        modifier = Modifier.width(268.dp).background(TmuxColors.bgCard),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        ) {
            Box(Modifier.size(7.dp).background(TmuxColors.statusConnected, CircleShape))
            Text(
                "Server running",
                color = TmuxColors.textPrimary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.sm,
                fontWeight = TmuxWeight.semibold,
                modifier = Modifier.padding(start = 8.dp),
            )
        }
        services.forEach { service ->
            ServiceRow(
                service,
                canOpen = service.state.equals("running", ignoreCase = true) && openUrl != null,
            ) {
                openUrl?.let(uriHandler::openUri)
                onServiceOpened()
            }
        }
        DropdownMenuItem(
            text = {
                Text(
                    "Stop environment",
                    color = TmuxColors.textSecondary,
                    fontFamily = TmuxFonts.sans,
                    fontSize = TmuxTextSize.sm,
                    fontWeight = TmuxWeight.semibold,
                )
            },
            leadingIcon = {
                Icon(
                    TmuxIcons.Square,
                    contentDescription = null,
                    tint = TmuxColors.textSecondary,
                    modifier = Modifier.size(14.dp),
                )
            },
            onClick = onStop,
        )
    }
}

@Composable
private fun ServiceRow(service: ComposeServiceStatus, canOpen: Boolean, onOpen: () -> Unit) {
    DropdownMenuItem(
        text = {
            Text(
                service.service,
                color = TmuxColors.textPrimary,
                fontFamily = TmuxFonts.mono,
                fontSize = TmuxTextSize.sm,
                fontWeight = TmuxWeight.semibold,
            )
        },
        leadingIcon = { Box(Modifier.size(7.dp).background(dotColor(service.state), CircleShape)) },
        trailingIcon = {
            if (canOpen) {
                Icon(
                    TmuxIcons.ExternalLink,
                    contentDescription = "Open in browser",
                    tint = TmuxColors.textTertiary,
                    modifier = Modifier.size(15.dp),
                )
            } else {
                Text(
                    service.state,
                    color = TmuxColors.textTertiary,
                    fontFamily = TmuxFonts.mono,
                    fontSize = TmuxTextSize.xs,
                )
            }
        },
        onClick = { if (canOpen) onOpen() },
    )
}
