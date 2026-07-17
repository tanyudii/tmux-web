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
import androidx.compose.runtime.LaunchedEffect
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
import com.tanyudii.tmuxweb.domain.model.EnvOpenLink
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
 *
 * [onOpenChanged] fires whenever the dropdown's open/closed state changes —
 * the web shell uses it to hide the terminal's native DOM element for the
 * duration (see [com.tanyudii.tmuxweb.terminal.PlatformTerminalView]'s
 * `isVisible` kdoc), since this dropdown is a `Popup` just like the other
 * modals affected by that same Compose Multiplatform Web limitation.
 */
@Composable
fun TmuxEnvironmentMenu(
    status: EnvStatus?,
    isBusy: Boolean,
    onRun: () -> Unit,
    onStop: () -> Unit,
    onViewLogs: (String) -> Unit,
    modifier: Modifier = Modifier,
    onOpenChanged: (Boolean) -> Unit = {},
    onCancel: () -> Unit = {},
) {
    if (status == null || status.phase == EnvPhase.UNAVAILABLE) return
    var open by remember { mutableStateOf(false) }
    LaunchedEffect(open) { onOpenChanged(open) }
    val running = status.phase == EnvPhase.RUNNING
    val starting = status.phase == EnvPhase.STARTING || (isBusy && status.phase == EnvPhase.IDLE)
    // Only wire the visible cancel affordance to the real cancel action once
    // the server has actually registered a "starting" transient -- see
    // EMB-209. The synchronous isBusy-before-poll-catches-up window is too
    // short for a user to realistically click Cancel in, and calling
    // cancelEnv() before the server-side store entry exists would just
    // surface a confusing EnvNotStartingError.
    val canCancel = status.phase == EnvPhase.STARTING
    val services = status.services.orEmpty()
    val upCount = services.count { it.state.equals("running", ignoreCase = true) }
    val uriHandler = LocalUriHandler.current

    Box(modifier = modifier) {
        EnvironmentToggleRow(
            running = running,
            starting = starting,
            canCancel = canCancel,
            upCount = upCount,
            serviceCount = services.size,
            onToggleOpen = { open = !open },
            onRun = onRun,
            onCancel = onCancel,
        )
        EnvironmentDropdownContent(
            open = open,
            running = running,
            services = services,
            openLinks = status.openLinks.orEmpty(),
            uriHandler = uriHandler,
            onDismiss = { open = false },
            onLinkOpened = { open = false },
            onStop = {
                open = false
                onStop()
            },
            onViewLogs = onViewLogs,
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
    canCancel: Boolean,
    upCount: Int,
    serviceCount: Int,
    onToggleOpen: () -> Unit,
    onRun: () -> Unit,
    onCancel: () -> Unit,
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
            if (canCancel) {
                TmuxIconButton(
                    icon = TmuxIcons.Close,
                    contentDescription = "Cancel environment setup",
                    onClick = onCancel,
                    size = TmuxIconButtonSize.SM,
                    modifier = Modifier.padding(start = 4.dp),
                )
            }
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
 * The services dropdown: header row, one [ServiceRow] per service (showing
 * an "open in a new tab" icon instead of its status text when that service
 * has a matching open link -- correlated by [EnvOpenLink.service], since a
 * user might run several openable services at once and needs to know which
 * icon opens which), a fallback [OpenLinkRow] for any configured link whose
 * service isn't in [services] for some reason, and the stop-environment
 * action. Split out of [TmuxEnvironmentMenu] purely to keep that
 * composable's cyclomatic complexity under the project's threshold — no
 * behavior change.
 */
@Composable
private fun EnvironmentDropdownContent(
    open: Boolean,
    running: Boolean,
    services: List<ComposeServiceStatus>,
    openLinks: List<EnvOpenLink>,
    uriHandler: UriHandler,
    onDismiss: () -> Unit,
    onLinkOpened: () -> Unit,
    onStop: () -> Unit,
    onViewLogs: (String) -> Unit,
) {
    val linksByService = openLinks.associateBy { it.service }
    val unmatchedLinks = openLinks.filter { link -> services.none { it.service == link.service } }
    DropdownMenu(
        expanded = open && running,
        onDismissRequest = onDismiss,
        modifier = Modifier.width(268.dp).background(TmuxColors.bgCard),
    ) {
        ServerRunningHeader()
        services.forEach { service ->
            ServiceRow(
                service = service,
                openLink = linksByService[service.service],
                onOpen = { link ->
                    uriHandler.openUri(link.url)
                    onLinkOpened()
                },
                onViewLogs = {
                    onDismiss()
                    onViewLogs(service.service)
                },
            )
        }
        unmatchedLinks.forEach { link ->
            OpenLinkRow(link) {
                uriHandler.openUri(link.url)
                onLinkOpened()
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
private fun ServerRunningHeader() {
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
}

/**
 * One "open in a new tab" affordance per configured link — this is the whole
 * point of the menu for a user who doesn't know which host port their
 * service ended up on (Docker Compose picks it dynamically unless pinned).
 * Only used as a fallback for a link whose service didn't match any row in
 * [EnvironmentDropdownContent]'s `services` list -- normally the icon shows
 * directly on that service's own [ServiceRow] instead.
 */
@Composable
private fun OpenLinkRow(link: EnvOpenLink, onOpen: () -> Unit) {
    DropdownMenuItem(
        text = {
            Text(
                link.label,
                color = TmuxColors.textPrimary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.sm,
                fontWeight = TmuxWeight.semibold,
            )
        },
        leadingIcon = {
            Icon(
                TmuxIcons.ExternalLink,
                contentDescription = null,
                tint = TmuxColors.accent,
                modifier = Modifier.size(15.dp),
            )
        },
        onClick = onOpen,
    )
}

@Composable
private fun ServiceRow(
    service: ComposeServiceStatus,
    openLink: EnvOpenLink?,
    onOpen: (EnvOpenLink) -> Unit,
    onViewLogs: () -> Unit,
) {
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                TmuxIconButton(
                    icon = TmuxIcons.Logs,
                    contentDescription = "View ${service.service} logs",
                    onClick = onViewLogs,
                    size = TmuxIconButtonSize.SM,
                )
                if (openLink != null) {
                    Icon(
                        TmuxIcons.ExternalLink,
                        contentDescription = "Open ${service.service} in a new tab",
                        tint = TmuxColors.accent,
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
            }
        },
        onClick = { openLink?.let(onOpen) },
    )
}
