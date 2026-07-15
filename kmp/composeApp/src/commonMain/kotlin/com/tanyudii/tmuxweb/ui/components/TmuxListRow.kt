package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxMonoSize
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxSpacing
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

private val ICON_BADGE_SIZE = 34.dp
private val ROW_LEFT_BORDER_WIDTH = 2.dp

/**
 * Tappable row for project/session lists — ports `components/data/ListRow.jsx`.
 * Leading icon badge, sans title, mono subtitle, sans meta line, and a
 * trailing slot that overrides the default chevron. [active] is the
 * web-sidebar/master-detail selected state (accent-fill background + left
 * accent border); mobile call sites simply never set it.
 */
@Composable
fun TmuxListRow(
    title: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    subtitle: String? = null,
    meta: String? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    chevron: Boolean = true,
    active: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val hovered by interactionSource.collectIsHoveredAsState()
    val background = rowBackgroundColor(active, hovered, onClick)
    val borderColor = if (active) TmuxColors.accent else Color.Transparent

    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = TmuxSpacing.rowHeight)
            .background(background)
            .drawBehind {
                drawRect(borderColor, size = size.copy(width = ROW_LEFT_BORDER_WIDTH.toPx()))
            }
            .let { if (onClick != null) it.semantics { role = Role.Button } else it }
            .hoverable(interactionSource, enabled = onClick != null)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                enabled = onClick != null,
                onClick = { onClick?.invoke() },
            )
            .padding(vertical = 10.dp, horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            RowIconBadge(icon = icon, active = active)
        }
        RowTexts(
            title = title,
            subtitle = subtitle,
            meta = meta,
            hasIcon = icon != null,
            modifier = Modifier.weight(1f),
        )
        RowTrailing(trailing = trailing, chevron = chevron, onClick = onClick)
    }
}

private fun rowBackgroundColor(active: Boolean, hovered: Boolean, onClick: (() -> Unit)?): Color = when {
    active -> TmuxColors.accentFill
    hovered && onClick != null -> TmuxColors.bgHover
    else -> Color.Transparent
}

/**
 * Title/subtitle/meta stack — split out of [TmuxListRow] purely to keep
 * that composable's complexity under the project's threshold — no
 * behavior change.
 */
@Composable
private fun RowTexts(title: String, subtitle: String?, meta: String?, hasIcon: Boolean, modifier: Modifier = Modifier) {
    Column(modifier = modifier.padding(start = if (hasIcon) 12.dp else 0.dp)) {
        Text(
            title,
            color = TmuxColors.textPrimary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.base,
            fontWeight = TmuxWeight.semibold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        subtitle?.let {
            Text(
                it,
                color = TmuxColors.textTertiary,
                fontFamily = TmuxFonts.mono,
                fontSize = TmuxMonoSize.sm,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        meta?.let {
            Text(
                it,
                color = TmuxColors.textTertiary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.xs,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

/**
 * Trailing slot / auto-chevron — split out of [TmuxListRow] purely to
 * keep that composable's complexity under the project's threshold — no
 * behavior change.
 */
@Composable
private fun RowScope.RowTrailing(
    trailing: (@Composable RowScope.() -> Unit)?,
    chevron: Boolean,
    onClick: (() -> Unit)?,
) {
    when {
        trailing != null -> trailing()
        chevron && onClick != null -> Icon(
            TmuxIcons.ChevronRight,
            contentDescription = null,
            tint = TmuxColors.textTertiary,
            modifier = Modifier.size(18.dp),
        )
    }
}

@Composable
private fun RowIconBadge(icon: ImageVector, active: Boolean) {
    Box(
        modifier = Modifier
            .size(ICON_BADGE_SIZE)
            .background(if (active) TmuxColors.greenGlow else TmuxColors.bgOverlay, RoundedCornerShape(TmuxRadius.sm)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (active) TmuxColors.accent else TmuxColors.textSecondary,
            modifier = Modifier.size(18.dp),
        )
    }
}
