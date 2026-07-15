package com.tanyudii.tmuxweb.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

enum class TmuxConnectionStatus { DISCONNECTED, RECONNECTING, CONNECTED }

private data class BannerKind(
    val icon: ImageVector,
    val color: Color,
    val bg: Color,
    val label: String,
    val spinning: Boolean,
)

private fun kindFor(status: TmuxConnectionStatus): BannerKind = when (status) {
    TmuxConnectionStatus.DISCONNECTED ->
        BannerKind(
            TmuxIcons.WifiOff,
            TmuxColors.statusDisconnected,
            TmuxColors.red500.copy(alpha = 0.14f),
            "Disconnected",
            spinning = false,
        )
    TmuxConnectionStatus.RECONNECTING ->
        BannerKind(
            TmuxIcons.Refresh,
            TmuxColors.statusReconnecting,
            TmuxColors.amber500.copy(alpha = 0.14f),
            "Reconnecting…",
            spinning = true,
        )
    TmuxConnectionStatus.CONNECTED ->
        BannerKind(
            TmuxIcons.Check,
            TmuxColors.statusConnected,
            TmuxColors.green500.copy(alpha = 0.14f),
            "Connected",
            spinning = false,
        )
}

/**
 * Full-width status strip pinned above the terminal when the socket drops —
 * ports `components/feedback/ConnectionBanner.jsx`. Callers add the bottom
 * hairline divider (`--border-{tone}`) themselves since it belongs to the
 * surrounding layout, not this component's own bounds.
 */
@Composable
fun TmuxConnectionBanner(
    status: TmuxConnectionStatus,
    modifier: Modifier = Modifier,
    message: String? = null,
    onRetry: (() -> Unit)? = null,
) {
    val kind = kindFor(status)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(kind.bg)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (kind.spinning) {
            SpinningBannerIcon(kind.icon, kind.color)
        } else {
            Icon(kind.icon, contentDescription = null, tint = kind.color, modifier = Modifier.size(16.dp))
        }
        Text(
            message ?: kind.label,
            color = kind.color,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.sm,
            fontWeight = TmuxWeight.medium,
            modifier = Modifier.weight(1f).padding(start = 10.dp),
        )
        if (onRetry != null) {
            Text(
                "Retry",
                color = kind.color,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.sm,
                fontWeight = TmuxWeight.semibold,
                modifier = Modifier.clickable(onClick = onRetry),
            )
        }
    }
}

private const val BANNER_SPIN_ANGLE_MAX = 360f
private const val BANNER_SPIN_DURATION_MS = 1000

@Composable
private fun SpinningBannerIcon(icon: ImageVector, tint: Color) {
    val transition = rememberInfiniteTransition()
    val angle by transition.animateFloat(
        0f,
        BANNER_SPIN_ANGLE_MAX,
        infiniteRepeatable(tween(BANNER_SPIN_DURATION_MS, easing = LinearEasing)),
    )
    Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp).rotate(angle))
}
