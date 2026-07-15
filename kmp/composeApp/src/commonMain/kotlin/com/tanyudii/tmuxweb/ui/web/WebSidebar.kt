package com.tanyudii.tmuxweb.ui.web

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tanyudii.tmuxweb.domain.model.Project
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.presentation.WebShellUiState
import com.tanyudii.tmuxweb.ui.components.TmuxIconButton
import com.tanyudii.tmuxweb.ui.components.TmuxIconButtonSize
import com.tanyudii.tmuxweb.ui.components.TmuxStatusBadge
import com.tanyudii.tmuxweb.ui.components.TmuxStatusTone
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxSpacing
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxTracking
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

/**
 * Persistent left sidebar — project -> session tree, connection badge,
 * collapse toggle, server-settings row. Ports the `<aside>` in
 * `ui_kits/web/app.jsx`; the sidebar tree itself is bespoke to this screen
 * (not the generic `ListRow` design-system component), matching how the
 * handoff's own Web kit defines a local `SidebarRow`, not a reused one.
 */
@Composable
fun WebSidebar(
    state: WebShellUiState,
    serverHost: String,
    isConnected: Boolean,
    onToggleCollapsed: () -> Unit,
    onToggleProject: (String) -> Unit,
    onSelectProject: (String) -> Unit,
    onSelectSession: (String, String) -> Unit,
    onNewProject: () -> Unit,
    onNewSession: (String) -> Unit,
    onDeleteProject: (Project) -> Unit,
    onDeleteSession: (String, ProjectSession) -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val width = if (state.sidebarCollapsed) TmuxSpacing.webSidebarCollapsedWidth else TmuxSpacing.webSidebarWidth

    Column(
        modifier = modifier
            .width(width)
            .fillMaxHeight()
            .background(TmuxColors.bgSurface),
    ) {
        SidebarHeader(collapsed = state.sidebarCollapsed, isConnected = isConnected)

        if (state.sidebarCollapsed) {
            CollapsedProjectRail(
                state.projects,
                state.selectedProjectId,
                onSelectProject,
                modifier = Modifier.weight(1f),
            )
        } else {
            LazyColumn(modifier = Modifier.weight(1f).padding(horizontal = TmuxSpacing.space3)) {
                item {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = TmuxSpacing.space3, vertical = TmuxSpacing.space2),
                    ) {
                        Text(
                            "PROJECTS",
                            color = TmuxColors.textTertiary,
                            fontFamily = TmuxFonts.sans,
                            fontSize = TmuxTextSize.xs2,
                            letterSpacing = TmuxTracking.caps,
                            modifier = Modifier.weight(1f),
                        )
                        TmuxIconButton(TmuxIcons.Plus, "New project", onNewProject, size = TmuxIconButtonSize.SM)
                    }
                }
                items(state.projects, key = { it.id }) { project ->
                    ProjectNode(
                        project = project,
                        state = state,
                        onToggleProject = onToggleProject,
                        onSelectProject = onSelectProject,
                        onSelectSession = onSelectSession,
                        onNewSession = onNewSession,
                        onDeleteProject = onDeleteProject,
                        onDeleteSession = onDeleteSession,
                    )
                }
            }
        }

        SidebarFooter(
            collapsed = state.sidebarCollapsed,
            serverHost = serverHost,
            onToggleCollapsed = onToggleCollapsed,
            onOpenSettings = onOpenSettings,
        )
    }
}

@Composable
private fun SidebarHeader(collapsed: Boolean, isConnected: Boolean) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().height(52.dp).padding(horizontal = if (collapsed) 0.dp else 14.dp),
        horizontalArrangement = if (collapsed) Arrangement.Center else Arrangement.Start,
    ) {
        if (collapsed) {
            Text(
                "$",
                color = TmuxColors.accent,
                fontFamily = TmuxFonts.mono,
                fontSize = TmuxTextSize.lg,
                fontWeight = TmuxWeight.bold,
            )
        } else {
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = TmuxColors.accent)) { append("$ ") }
                    append("tmux-web")
                },
                color = TmuxColors.textPrimary,
                fontFamily = TmuxFonts.mono,
                fontSize = TmuxTextSize.base,
                fontWeight = TmuxWeight.semibold,
            )
            Spacer(Modifier.weight(1f))
            TmuxStatusBadge(
                text = if (isConnected) "live" else "…",
                tone = if (isConnected) TmuxStatusTone.CONNECTED else TmuxStatusTone.RECONNECTING,
                dot = true,
                pulse = !isConnected,
            )
        }
    }
}

@Composable
private fun CollapsedProjectRail(
    projects: List<Project>,
    selectedProjectId: String?,
    onSelectProject: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(vertical = TmuxSpacing.space3),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(TmuxSpacing.space2),
    ) {
        projects.forEach { project ->
            val selected = project.id == selectedProjectId
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(TmuxRadius.md))
                    .background(if (selected) TmuxColors.accentFill else Color.Transparent)
                    .clickable { onSelectProject(project.id) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    TmuxIcons.Folder,
                    contentDescription = project.name,
                    tint = if (selected) TmuxColors.accent else TmuxColors.textSecondary,
                    modifier = Modifier.size(17.dp),
                )
            }
        }
    }
}

@Composable
private fun ProjectNode(
    project: Project,
    state: WebShellUiState,
    onToggleProject: (String) -> Unit,
    onSelectProject: (String) -> Unit,
    onSelectSession: (String, String) -> Unit,
    onNewSession: (String) -> Unit,
    onDeleteProject: (Project) -> Unit,
    onDeleteSession: (String, ProjectSession) -> Unit,
) {
    val expanded = project.id in state.expandedProjectIds
    val sessions = state.sessionsByProjectId[project.id].orEmpty()
    val projectActive = state.selectedProjectId == project.id && state.selectedSessionName == null

    Column {
        SidebarRow(
            icon = if (expanded) TmuxIcons.ChevronDown else TmuxIcons.ChevronRight,
            label = project.name,
            subtitle = sessions.size.toString(),
            active = projectActive,
            onClick = { onToggleProject(project.id); onSelectProject(project.id) },
            onDelete = { onDeleteProject(project) },
        )
        if (expanded) {
            sessions.forEach { session ->
                SidebarRow(
                    depth = 1,
                    dot = session.attached,
                    label = session.name,
                    subtitle = "${session.windows}w",
                    active = state.selectedSessionName == session.name && state.selectedProjectId == project.id,
                    onClick = { onSelectSession(project.id, session.name) },
                    onDelete = { onDeleteSession(project.id, session) },
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(30.dp)
                    .padding(start = 28.dp)
                    .clickable { onNewSession(project.id) },
            ) {
                Icon(
                    TmuxIcons.Plus,
                    contentDescription = null,
                    tint = TmuxColors.textTertiary,
                    modifier = Modifier.size(14.dp),
                )
                Text(
                    "New session",
                    color = TmuxColors.textTertiary,
                    fontFamily = TmuxFonts.sans,
                    fontSize = TmuxTextSize.sm,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun SidebarRow(
    label: String,
    subtitle: String,
    active: Boolean,
    onClick: () -> Unit,
    onDelete: () -> Unit,
    icon: ImageVector? = null,
    dot: Boolean? = null,
    depth: Int = 0,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val hovered by interactionSource.collectIsHoveredAsState()

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(34.dp)
            .clip(RoundedCornerShape(TmuxRadius.sm))
            .background(if (active) TmuxColors.accentFill else if (hovered) TmuxColors.bgHover else Color.Transparent)
            .hoverable(interactionSource)
            .clickable(onClick = onClick)
            .padding(start = (10 + depth * 18).dp, end = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        if (dot != null) {
            Box(Modifier.size(7.dp).background(if (dot) TmuxColors.accent else TmuxColors.gray600, CircleShape))
        }
        icon?.let {
            Icon(
                it,
                contentDescription = null,
                tint = if (active) TmuxColors.accent else TmuxColors.textSecondary,
                modifier = Modifier.size(16.dp),
            )
        }
        Text(
            label,
            color = if (active) TmuxColors.textPrimary else TmuxColors.textSecondary,
            fontFamily = TmuxFonts.sans,
            fontSize = 13.5.sp,
            fontWeight = if (active) TmuxWeight.semibold else TmuxWeight.medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (hovered) {
            Icon(
                TmuxIcons.Trash,
                contentDescription = "Delete $label",
                tint = TmuxColors.textTertiary,
                modifier = Modifier.size(14.dp).clickable(onClick = onDelete),
            )
        } else {
            Text(subtitle, color = TmuxColors.textTertiary, fontFamily = TmuxFonts.mono, fontSize = TmuxTextSize.xs)
        }
    }
}

@Composable
private fun SidebarFooter(
    collapsed: Boolean,
    serverHost: String,
    onToggleCollapsed: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(TmuxSpacing.space3)) {
        if (!collapsed) {
            SidebarRow(
                icon = TmuxIcons.Settings,
                label = "Server settings",
                subtitle = serverHost,
                active = false,
                onClick = onOpenSettings,
                onDelete = {},
            )
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = if (collapsed) Arrangement.Center else Arrangement.Start,
            modifier = Modifier
                .fillMaxWidth()
                .height(34.dp)
                .clip(RoundedCornerShape(TmuxRadius.sm))
                .clickable(onClick = onToggleCollapsed)
                .padding(horizontal = if (collapsed) 0.dp else 10.dp),
        ) {
            Icon(
                if (collapsed) TmuxIcons.ChevronRight else TmuxIcons.ChevronLeft,
                contentDescription = if (collapsed) "Expand sidebar" else "Collapse sidebar",
                tint = TmuxColors.textTertiary,
                modifier = Modifier.size(16.dp),
            )
            if (!collapsed) {
                Text(
                    "Collapse",
                    color = TmuxColors.textTertiary,
                    fontFamily = TmuxFonts.sans,
                    fontSize = TmuxTextSize.sm,
                    modifier = Modifier.padding(start = 9.dp),
                )
            }
        }
    }
}
