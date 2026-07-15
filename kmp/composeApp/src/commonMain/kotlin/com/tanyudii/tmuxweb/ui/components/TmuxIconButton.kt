package com.tanyudii.tmuxweb.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxMotion
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius

enum class TmuxIconButtonVariant { GHOST, FILLED, DANGER }

enum class TmuxIconButtonSize { SM, MD, LG }

private fun diameter(size: TmuxIconButtonSize): Dp = when (size) {
    TmuxIconButtonSize.SM -> 32.dp
    TmuxIconButtonSize.MD -> 40.dp
    TmuxIconButtonSize.LG -> 44.dp
}

private fun iconSize(size: TmuxIconButtonSize): Dp = when (size) {
    TmuxIconButtonSize.SM -> 16.dp
    TmuxIconButtonSize.MD -> 20.dp
    TmuxIconButtonSize.LG -> 22.dp
}

private data class IconButtonColors(val idle: Color, val bg: Color, val hoverBg: Color, val hoverColor: Color)

private fun variantColors(variant: TmuxIconButtonVariant): IconButtonColors = when (variant) {
    TmuxIconButtonVariant.GHOST -> IconButtonColors(
        idle = TmuxColors.textSecondary,
        bg = Color.Transparent,
        hoverBg = TmuxColors.bgHover,
        hoverColor = TmuxColors.textPrimary,
    )
    TmuxIconButtonVariant.FILLED -> IconButtonColors(
        idle = TmuxColors.textPrimary,
        bg = TmuxColors.bgOverlay,
        hoverBg = TmuxColors.gray700,
        hoverColor = TmuxColors.textPrimary,
    )
    TmuxIconButtonVariant.DANGER -> IconButtonColors(
        idle = TmuxColors.red500,
        bg = Color.Transparent,
        hoverBg = TmuxColors.redGlow,
        hoverColor = TmuxColors.red500,
    )
}

/**
 * Square, icon-only control (toolbar, nav bar, row actions) — ports
 * `components/forms/IconButton.jsx`.
 */
@Composable
fun TmuxIconButton(
    icon: ImageVector,
    contentDescription: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: TmuxIconButtonSize = TmuxIconButtonSize.MD,
    variant: TmuxIconButtonVariant = TmuxIconButtonVariant.GHOST,
    enabled: Boolean = true,
) {
    val colors = remember(variant) { variantColors(variant) }
    val interactionSource = remember { MutableInteractionSource() }
    val hovered by interactionSource.collectIsHoveredAsState()

    val bg by animateColorAsState(
        if (!enabled) Color.Transparent else if (hovered) colors.hoverBg else colors.bg,
        tween(TmuxMotion.DURATION_FAST_MS),
    )
    val tint = when {
        !enabled -> TmuxColors.textDisabled
        hovered -> colors.hoverColor
        else -> colors.idle
    }

    Box(
        modifier = modifier
            .size(diameter(size))
            .background(bg, RoundedCornerShape(TmuxRadius.sm))
            .semantics { role = Role.Button }
            .hoverable(interactionSource, enabled = enabled)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                enabled = enabled,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = tint,
            modifier = Modifier.size(iconSize(size)),
        )
    }
}
