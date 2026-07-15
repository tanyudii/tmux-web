package com.tanyudii.tmuxweb.ui.web

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.domain.model.ChangedFile
import com.tanyudii.tmuxweb.domain.model.EnvStatus
import com.tanyudii.tmuxweb.domain.model.FileStatus
import com.tanyudii.tmuxweb.domain.model.GroupedChanges
import com.tanyudii.tmuxweb.domain.model.Project
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.terminal.PlatformTerminalView
import com.tanyudii.tmuxweb.ui.components.TmuxButton
import com.tanyudii.tmuxweb.ui.components.TmuxButtonVariant
import com.tanyudii.tmuxweb.ui.components.TmuxConnectionBanner
import com.tanyudii.tmuxweb.ui.components.TmuxConnectionStatus
import com.tanyudii.tmuxweb.ui.components.TmuxEnvironmentMenu
import com.tanyudii.tmuxweb.ui.components.TmuxIconButton
import com.tanyudii.tmuxweb.ui.components.TmuxIconButtonSize
import com.tanyudii.tmuxweb.ui.components.TmuxIconButtonVariant
import com.tanyudii.tmuxweb.ui.components.TmuxStatusBadge
import com.tanyudii.tmuxweb.ui.components.TmuxStatusTone
import com.tanyudii.tmuxweb.ui.terminal.TerminalSession
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

/**
 * Master-detail main area: breadcrumb top bar, tmux window tabs, terminal
 * viewport, and the git-changes rail — ports the `<main>` in
 * `ui_kits/web/app.jsx`. Window "tabs" here send the real tmux prefix
 * (Ctrl+B) + digit key sequence into the PTY rather than calling a
 * per-window REST endpoint: the backend contract (plan §2.2) has no such
 * endpoint — window switching is a tmux keybinding, not an API call — so
 * `activeWindow` below is a local optimistic highlight only, not a value
 * the backend confirms.
 */
@Composable
fun WebMainPane(
    project: Project?,
    session: ProjectSession?,
    terminal: TerminalSession?,
    changes: GroupedChanges?,
    environment: EnvStatus?,
    environmentBusy: Boolean,
    railOpen: Boolean,
    activeWindow: Int,
    onSelectWindow: (Int) -> Unit,
    onToggleRail: () -> Unit,
    onNewSession: () -> Unit,
    onEnvironmentRun: () -> Unit,
    onEnvironmentStop: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize().background(TmuxColors.bgApp)) {
        if (session == null || terminal == null) {
            EmptyMainPane(project = project, onNewSession = onNewSession)
            return@Column
        }

        TopBar(
            project = project,
            session = session,
            environment = environment,
            environmentBusy = environmentBusy,
            railOpen = railOpen,
            onToggleRail = onToggleRail,
            onEnvironmentRun = onEnvironmentRun,
            onEnvironmentStop = onEnvironmentStop,
        )
        WindowTabs(
            windowCount = session.windows,
            activeWindow = activeWindow,
            onSelectWindow = onSelectWindow,
            terminal = terminal,
        )

        if (!terminal.isConnected) {
            TmuxConnectionBanner(status = TmuxConnectionStatus.RECONNECTING, message = "Reconnecting to the server…")
        }

        Row(modifier = Modifier.weight(1f).fillMaxWidth()) {
            Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
                PlatformTerminalView(
                    modifier = Modifier.fillMaxSize(),
                    onInput = terminal::onInput,
                    onBell = terminal::onBell,
                    onResize = terminal::onResize,
                    handleReady = terminal.onHandleReady,
                )
            }
            if (railOpen) {
                ChangesRail(changes = changes)
            }
        }

        StatusFooter(session = session)
    }
}

@Composable
private fun TopBar(
    project: Project?,
    session: ProjectSession,
    environment: EnvStatus?,
    environmentBusy: Boolean,
    railOpen: Boolean,
    onToggleRail: () -> Unit,
    onEnvironmentRun: () -> Unit,
    onEnvironmentStop: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .background(TmuxColors.bgSurface)
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "${project?.name.orEmpty()} / ${session.name}",
            color = TmuxColors.textTertiary,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxTextSize.sm,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        TmuxStatusBadge(
            text = if (session.attached) "attached" else "detached",
            tone = if (session.attached) TmuxStatusTone.ATTACHED else TmuxStatusTone.IDLE,
            dot = session.attached,
        )
        Box(modifier = Modifier.weight(1f))
        TmuxEnvironmentMenu(
            status = environment,
            isBusy = environmentBusy,
            onRun = onEnvironmentRun,
            onStop = onEnvironmentStop,
        )
        TmuxIconButton(
            TmuxIcons.GitBranch,
            "Changes",
            onToggleRail,
            variant = if (railOpen) TmuxIconButtonVariant.FILLED else TmuxIconButtonVariant.GHOST,
        )
    }
}

@Composable
private fun WindowTabs(windowCount: Int, activeWindow: Int, onSelectWindow: (Int) -> Unit, terminal: TerminalSession) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(36.dp)
            .background(TmuxColors.bgTerminal)
            .padding(horizontal = 8.dp),
    ) {
        for (index in 0 until windowCount) {
            val active = index == activeWindow
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxHeight()
                    .background(if (active) TmuxColors.bgRaised else Color.Transparent)
                    .clickable {
                        onSelectWindow(index)
                        // Real tmux prefix (Ctrl+B) + window index — no per-window REST endpoint exists (see kdoc).
                        terminal.onInput(TMUX_PREFIX_CTRL_B + index.toString())
                    }
                    .padding(horizontal = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Text(
                    index.toString(),
                    color = if (active) TmuxColors.accent else TmuxColors.textTertiary,
                    fontFamily = TmuxFonts.mono,
                    fontSize = TmuxTextSize.xs,
                )
                Text(
                    "win$index",
                    color = if (active) TmuxColors.textPrimary else TmuxColors.textTertiary,
                    fontFamily = TmuxFonts.mono,
                    fontSize = TmuxTextSize.xs,
                )
            }
        }
    }
}

private val TMUX_PREFIX_CTRL_B = Char(2).toString()

@Composable
private fun ChangesRail(changes: GroupedChanges?) {
    Column(
        modifier = Modifier
            .width(290.dp)
            .fillMaxHeight()
            .background(TmuxColors.bgSurface),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().height(40.dp).padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                TmuxIcons.GitBranch,
                contentDescription = null,
                tint = TmuxColors.textTertiary,
                modifier = Modifier.size(15.dp),
            )
            Text(
                "Changes",
                color = TmuxColors.textPrimary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.sm,
                fontWeight = TmuxWeight.semibold,
            )
        }
        val entries = changes?.let { it.staged + it.unstaged + it.untracked }.orEmpty()
        LazyColumn(modifier = Modifier.weight(1f), contentPadding = PaddingValues(vertical = 6.dp)) {
            items(entries) { file -> ChangedFileRow(file) }
        }
        Box(modifier = Modifier.fillMaxWidth().padding(12.dp)) {
            TmuxButton(
                onClick = {},
                text = "Stage all · commit",
                variant = TmuxButtonVariant.SECONDARY,
                icon = TmuxIcons.GitBranch,
                fillWidth = true,
            )
        }
    }
}

@Composable
private fun ChangedFileRow(file: ChangedFile) {
    val (marker, color) = when (file.status) {
        FileStatus.ADDED -> "A" to TmuxColors.gitAdded
        FileStatus.MODIFIED -> "M" to TmuxColors.gitUnstaged
        FileStatus.DELETED -> "D" to TmuxColors.gitRemoved
        FileStatus.RENAMED -> "R" to TmuxColors.gitUntracked
        FileStatus.UNTRACKED -> "U" to TmuxColors.gitUntracked
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            marker,
            color = color,
            fontFamily = TmuxFonts.mono,
            fontWeight = TmuxWeight.semibold,
            fontSize = TmuxTextSize.sm,
        )
        Text(
            file.path,
            color = TmuxColors.textSecondary,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxTextSize.xs,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun StatusFooter(session: ProjectSession) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(26.dp)
            .background(TmuxColors.bgSurface)
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        FooterText("${session.windows} windows")
        FooterText("utf-8")
        Box(modifier = Modifier.weight(1f))
        FooterText("^B prefix")
    }
}

@Composable
private fun FooterText(text: String) {
    Text(text, color = TmuxColors.textTertiary, fontFamily = TmuxFonts.mono, fontSize = TmuxTextSize.xs2)
}

@Composable
private fun EmptyMainPane(project: Project?, onNewSession: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(TmuxColors.bgSurface),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                TmuxIcons.Terminal,
                contentDescription = null,
                tint = TmuxColors.textTertiary,
                modifier = Modifier.size(34.dp),
            )
        }
        Text(
            text = if (project != null) "No session selected in ${project.name}" else "Select a session",
            color = TmuxColors.textPrimary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.md,
            fontWeight = TmuxWeight.semibold,
        )
        Text(
            "Pick a session from the sidebar, or start a new one.",
            color = TmuxColors.textTertiary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.sm,
        )
        TmuxButton(
            onClick = onNewSession,
            text = "New session",
            variant = TmuxButtonVariant.PRIMARY,
            icon = TmuxIcons.Plus,
        )
    }
}
