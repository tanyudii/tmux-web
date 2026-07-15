package com.tanyudii.tmuxweb.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxTracking
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

enum class TmuxStatusTone {
    CONNECTED,
    DISCONNECTED,
    RECONNECTING,
    ATTACHED,
    IDLE,
    INFO,
    STAGED,
    UNSTAGED,
    UNTRACKED,
    NEUTRAL,
}

/** Pulsing-dot animation tuning, ports the CSS `pulse` keyframe on live/reconnecting badges. */
private const val PULSE_SCALE_MAX = 1.8f
private const val PULSE_DURATION_MS = 1600
private const val PULSE_RING_ALPHA_FADE = 0.6f

private data class ToneColors(val color: Color, val bg: Color)

private fun toneColors(tone: TmuxStatusTone): ToneColors = when (tone) {
    TmuxStatusTone.CONNECTED -> ToneColors(TmuxColors.statusConnected, TmuxColors.greenGlow)
    TmuxStatusTone.DISCONNECTED -> ToneColors(TmuxColors.statusDisconnected, TmuxColors.redGlow)
    TmuxStatusTone.RECONNECTING -> ToneColors(TmuxColors.statusReconnecting, TmuxColors.amberGlow)
    TmuxStatusTone.ATTACHED -> ToneColors(TmuxColors.statusAttached, TmuxColors.violetGlow)
    TmuxStatusTone.IDLE -> ToneColors(TmuxColors.textTertiary, TmuxColors.bgOverlay)
    TmuxStatusTone.INFO -> ToneColors(TmuxColors.blue500, TmuxColors.blueGlow)
    TmuxStatusTone.STAGED -> ToneColors(TmuxColors.gitStaged, TmuxColors.greenGlow)
    TmuxStatusTone.UNSTAGED -> ToneColors(TmuxColors.gitUnstaged, TmuxColors.amberGlow)
    TmuxStatusTone.UNTRACKED -> ToneColors(TmuxColors.gitUntracked, TmuxColors.blueGlow)
    TmuxStatusTone.NEUTRAL -> ToneColors(TmuxColors.textSecondary, TmuxColors.bgOverlay)
}

/**
 * Small pill conveying connection/git/session state — ports
 * `components/feedback/StatusBadge.jsx`. Optional leading dot, optional
 * pulse animation on the dot (reconnecting/live states).
 */
@Composable
fun TmuxStatusBadge(
    text: String,
    tone: TmuxStatusTone,
    modifier: Modifier = Modifier,
    dot: Boolean = false,
    mono: Boolean = false,
    pulse: Boolean = false,
) {
    val colors = remember(tone) { toneColors(tone) }
    Row(
        modifier = modifier
            .height(22.dp)
            .background(colors.bg, RoundedCornerShape(TmuxRadius.full))
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dot) {
            PulsingDot(color = colors.color, pulse = pulse, modifier = Modifier.padding(end = 6.dp))
        }
        Text(
            text,
            color = colors.color,
            fontFamily = if (mono) TmuxFonts.mono else TmuxFonts.sans,
            fontSize = TmuxTextSize.xs,
            fontWeight = TmuxWeight.semibold,
            letterSpacing = if (mono) TmuxTracking.normal else TmuxTracking.wide,
        )
    }
}

@Composable
private fun PulsingDot(color: Color, pulse: Boolean, modifier: Modifier = Modifier) {
    if (!pulse) {
        Box(modifier.size(6.dp).background(color, CircleShape))
        return
    }
    val transition = rememberInfiniteTransition()
    val scale by transition.animateFloat(
        1f,
        PULSE_SCALE_MAX,
        infiniteRepeatable(tween(PULSE_DURATION_MS), RepeatMode.Restart),
    )
    val alpha by transition.animateFloat(
        1f,
        0f,
        infiniteRepeatable(tween(PULSE_DURATION_MS), RepeatMode.Restart),
    )
    Box(modifier.size(6.dp)) {
        Box(
            Modifier.size(6.dp).scale(scale).alpha(alpha * PULSE_RING_ALPHA_FADE).background(color, CircleShape),
        )
        Box(Modifier.size(6.dp).background(color, CircleShape))
    }
}
