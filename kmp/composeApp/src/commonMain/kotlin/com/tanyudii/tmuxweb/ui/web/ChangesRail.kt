package com.tanyudii.tmuxweb.ui.web

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.domain.FileTreeNode
import com.tanyudii.tmuxweb.domain.model.ChangedFile
import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.FileStatus
import com.tanyudii.tmuxweb.domain.model.GroupedChanges
import com.tanyudii.tmuxweb.presentation.ChangeRow
import com.tanyudii.tmuxweb.presentation.buildChangeRows
import com.tanyudii.tmuxweb.ui.components.TmuxButton
import com.tanyudii.tmuxweb.ui.components.TmuxButtonVariant
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxTracking
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

/**
 * Renders [buildChangeRows]'s flattened Staged/Changes/Untracked tree as a
 * single flat `LazyColumn` -- folder and group collapse state lives here as
 * plain UI state (a set of [ChangeRow.key]s), the same way [WebMainPane]
 * keeps `environmentMenuOpen`/`windowDialogOpen` local rather than pushing
 * presentational-only state into a ViewModel. Split out of `WebMainPane.kt`
 * purely to keep that file's function count under the project's detekt
 * threshold -- mirrors how `WindowActionDialogs` was split out of
 * `WindowTabs.kt` -- no behavior change from that split itself.
 */
@Composable
internal fun ChangesRail(changes: GroupedChanges?, onFileClick: (ChangedFile, DiffMode) -> Unit) {
    var collapsedKeys by remember { mutableStateOf(emptySet<String>()) }
    val rows = buildChangeRows(changes, collapsedKeys)

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
        LazyColumn(modifier = Modifier.weight(1f), contentPadding = PaddingValues(vertical = 6.dp)) {
            items(rows, key = { it.key }) { row ->
                ChangeRowItem(
                    row = row,
                    collapsed = row.key in collapsedKeys,
                    onToggle = { key -> collapsedKeys = collapsedKeys.toggled(key) },
                    onFileClick = onFileClick,
                )
            }
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
private fun ChangeRowItem(
    row: ChangeRow,
    collapsed: Boolean,
    onToggle: (String) -> Unit,
    onFileClick: (ChangedFile, DiffMode) -> Unit,
) {
    when (row) {
        is ChangeRow.GroupHeader -> ChangeGroupHeaderRow(
            label = row.label,
            count = row.count,
            collapsed = collapsed,
            onClick = { onToggle(row.key) },
        )
        is ChangeRow.Node -> ChangeNodeRow(
            node = row.node,
            depth = row.depth,
            collapsed = collapsed,
            onClick = {
                if (row.node.isFolder) {
                    onToggle(row.key)
                } else {
                    row.node.file?.let { onFileClick(it, row.mode) }
                }
            },
        )
    }
}

@Composable
private fun ChangeGroupHeaderRow(label: String, count: Int, collapsed: Boolean, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(28.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(
            if (collapsed) TmuxIcons.ChevronRight else TmuxIcons.ChevronDown,
            contentDescription = null,
            tint = TmuxColors.textTertiary,
            modifier = Modifier.size(14.dp),
        )
        Text(
            label.uppercase(),
            color = TmuxColors.textTertiary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.xs2,
            letterSpacing = TmuxTracking.caps,
            modifier = Modifier.weight(1f),
        )
        Text(count.toString(), color = TmuxColors.textTertiary, fontFamily = TmuxFonts.mono, fontSize = TmuxTextSize.xs)
    }
}

/**
 * A folder (collapsible, chevron) or file (status marker) node, indented by
 * [depth] -- mirrors [WebSidebar]'s `SidebarRow`.
 */
@Composable
private fun ChangeNodeRow(node: FileTreeNode, depth: Int, collapsed: Boolean, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(start = (14 + depth * 16).dp, end = 14.dp, top = 6.dp, bottom = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (node.isFolder) {
            Icon(
                if (collapsed) TmuxIcons.ChevronRight else TmuxIcons.ChevronDown,
                contentDescription = null,
                tint = TmuxColors.textTertiary,
                modifier = Modifier.size(14.dp),
            )
        } else {
            val (marker, color) = node.file?.status?.let(::fileStatusMarker) ?: ("?" to TmuxColors.textTertiary)
            Text(
                marker,
                color = color,
                fontFamily = TmuxFonts.mono,
                fontWeight = TmuxWeight.semibold,
                fontSize = TmuxTextSize.sm,
                modifier = Modifier.width(14.dp),
            )
        }
        Text(
            node.name,
            color = TmuxColors.textSecondary,
            fontFamily = if (node.isFolder) TmuxFonts.sans else TmuxFonts.mono,
            fontSize = TmuxTextSize.xs,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

private fun Set<String>.toggled(key: String): Set<String> = if (key in this) this - key else this + key

private fun fileStatusMarker(status: FileStatus): Pair<String, Color> = when (status) {
    FileStatus.ADDED -> "A" to TmuxColors.gitAdded
    FileStatus.MODIFIED -> "M" to TmuxColors.gitUnstaged
    FileStatus.DELETED -> "D" to TmuxColors.gitRemoved
    FileStatus.RENAMED -> "R" to TmuxColors.gitUntracked
    FileStatus.UNTRACKED -> "U" to TmuxColors.gitUntracked
}
