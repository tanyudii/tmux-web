package com.tanyudii.tmuxweb.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxMotion
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxTracking
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

enum class TmuxButtonVariant { PRIMARY, SECONDARY, GHOST, DANGER, DANGER_GHOST }

enum class TmuxButtonSize { SM, MD, LG }

/** One-off danger-variant tints with no dedicated design token elsewhere. */
private val DANGER_HOVER_BG = Color(0xFFF77D75)
private val DANGER_CONTENT_ON_DANGER = Color(0xFF2B0A08)

private data class ButtonSizeSpec(
    val height: Dp,
    val horizontalPadding: Dp,
    val fontSize: TextUnit,
    val gap: Dp,
    val iconSize: Dp,
)

private fun ButtonSizeSpec(size: TmuxButtonSize): ButtonSizeSpec = when (size) {
    TmuxButtonSize.SM -> ButtonSizeSpec(32.dp, 12.dp, TmuxTextSize.sm, 6.dp, 16.dp)
    TmuxButtonSize.MD -> ButtonSizeSpec(40.dp, 16.dp, TmuxTextSize.base, 8.dp, 18.dp)
    TmuxButtonSize.LG -> ButtonSizeSpec(48.dp, 20.dp, TmuxTextSize.md, 8.dp, 20.dp)
}

private data class ButtonVariantColors(
    val bg: Color,
    val hoverBg: Color,
    val pressBg: Color,
    val content: Color,
    val border: Color,
)

private fun variantColors(variant: TmuxButtonVariant): ButtonVariantColors = when (variant) {
    TmuxButtonVariant.PRIMARY -> ButtonVariantColors(
        bg = TmuxColors.accent,
        hoverBg = TmuxColors.accentHover,
        pressBg = TmuxColors.accentPress,
        content = TmuxColors.textOnAccent,
        border = Color.Transparent,
    )
    TmuxButtonVariant.SECONDARY -> ButtonVariantColors(
        bg = TmuxColors.bgOverlay,
        hoverBg = TmuxColors.gray700,
        pressBg = TmuxColors.gray700,
        content = TmuxColors.textPrimary,
        border = TmuxColors.borderDefault,
    )
    TmuxButtonVariant.GHOST -> ButtonVariantColors(
        bg = Color.Transparent,
        hoverBg = TmuxColors.bgHover,
        pressBg = TmuxColors.bgActive,
        content = TmuxColors.textSecondary,
        border = Color.Transparent,
    )
    TmuxButtonVariant.DANGER -> ButtonVariantColors(
        bg = TmuxColors.red500,
        hoverBg = DANGER_HOVER_BG,
        pressBg = TmuxColors.red600,
        content = DANGER_CONTENT_ON_DANGER,
        border = Color.Transparent,
    )
    TmuxButtonVariant.DANGER_GHOST -> ButtonVariantColors(
        bg = Color.Transparent,
        hoverBg = TmuxColors.redGlow,
        pressBg = TmuxColors.redGlow,
        content = TmuxColors.red500,
        border = Color.Transparent,
    )
}

private data class ButtonStateColors(val background: Color, val content: Color, val border: Color)

/**
 * Resolves the interaction-dependent background plus the disabled-dependent
 * content/border colors. Split out of [TmuxButton] purely to keep that
 * composable's cyclomatic complexity under the project's threshold — no
 * behavior change.
 */
private fun resolveButtonStateColors(
    isDisabled: Boolean,
    pressed: Boolean,
    hovered: Boolean,
    colors: ButtonVariantColors,
): ButtonStateColors {
    val background = when {
        isDisabled -> TmuxColors.gray800
        pressed -> colors.pressBg
        hovered -> colors.hoverBg
        else -> colors.bg
    }
    val content = if (isDisabled) TmuxColors.textDisabled else colors.content
    val border = if (isDisabled) TmuxColors.borderSubtle else colors.border
    return ButtonStateColors(background, content, border)
}

/**
 * Primary action control — ports `components/forms/Button.jsx`. Variants:
 * primary/secondary/ghost/danger/danger-ghost; sm/md/lg sizes; loading,
 * disabled, block (fill-width), leading/trailing icon.
 */
@Composable
fun TmuxButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    text: String? = null,
    variant: TmuxButtonVariant = TmuxButtonVariant.PRIMARY,
    size: TmuxButtonSize = TmuxButtonSize.MD,
    icon: ImageVector? = null,
    trailingIcon: ImageVector? = null,
    loading: Boolean = false,
    enabled: Boolean = true,
    fillWidth: Boolean = false,
) {
    val spec = remember(size) { ButtonSizeSpec(size) }
    val colors = remember(variant) { variantColors(variant) }
    val isDisabled = !enabled || loading
    val interactionSource = remember { MutableInteractionSource() }
    val hovered by interactionSource.collectIsHoveredAsState()
    val pressed by interactionSource.collectIsPressedAsState()

    val stateColors = resolveButtonStateColors(isDisabled, pressed, hovered, colors)
    val bg by animateColorAsState(stateColors.background, tween(TmuxMotion.DURATION_FAST_MS))
    val contentColor = stateColors.content
    val borderColor = stateColors.border

    Row(
        modifier = modifier
            .let { if (fillWidth) it.fillMaxWidth() else it.wrapContentWidth() }
            .defaultMinSize(minWidth = spec.height)
            .height(spec.height)
            .background(bg, RoundedCornerShape(TmuxRadius.sm))
            .border(1.dp, borderColor, RoundedCornerShape(TmuxRadius.sm))
            .semantics { role = Role.Button }
            .hoverable(interactionSource, enabled = !isDisabled)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                enabled = !isDisabled,
                onClick = onClick,
            )
            .padding(horizontal = spec.horizontalPadding),
        horizontalArrangement = Arrangement.spacedBy(spec.gap, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ButtonLeadingContent(loading = loading, icon = icon, size = spec.iconSize, tint = contentColor)
        text?.let {
            Text(
                text = it,
                color = contentColor,
                fontSize = spec.fontSize,
                fontFamily = TmuxFonts.sans,
                fontWeight = TmuxWeight.semibold,
                letterSpacing = TmuxTracking.tight,
            )
        }
        ButtonTrailingIcon(loading = loading, icon = trailingIcon, size = spec.iconSize, tint = contentColor)
    }
}

/** Leading slot: spinner while loading, otherwise the optional leading icon. */
@Composable
private fun ButtonLeadingContent(loading: Boolean, icon: ImageVector?, size: Dp, tint: Color) {
    when {
        loading -> SpinningIcon(TmuxIcons.Spinner, size, tint)
        icon != null -> Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.height(size))
    }
}

/** Trailing icon, hidden while loading (the leading slot already shows the spinner). */
@Composable
private fun ButtonTrailingIcon(loading: Boolean, icon: ImageVector?, size: Dp, tint: Color) {
    if (!loading && icon != null) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.height(size))
    }
}

private const val SPIN_DURATION_MS = 800

@Composable
internal fun SpinningIcon(icon: ImageVector, size: Dp, tint: Color) {
    val transition = rememberInfiniteTransition()
    val angle by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(SPIN_DURATION_MS, easing = LinearEasing), RepeatMode.Restart),
    )
    Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.height(size).rotate(angle))
}
