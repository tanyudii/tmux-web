package com.tanyudii.tmuxweb.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize

/** Progress values are expressed as a 0-100 percentage, mirroring the CSS `value` prop. */
private const val PROGRESS_MAX_PERCENT = 100f

/** Sweep keyframe start, as a fraction of the track width (`left: -40%`). */
private const val SWEEP_START_FRACTION = -0.4f

/** Sweep bar width, as a fraction of the track width (`width: 40%`). */
private const val SWEEP_WIDTH_FRACTION = 0.4f

/** Sweep animation duration in ms, one full indeterminate cycle. */
private const val SWEEP_DURATION_MS = 1300

/**
 * Determinate or indeterminate progress track — ports
 * `components/feedback/ProgressBar.jsx`. `value = null` renders the sweeping
 * indeterminate bar used while a new tmux session is being created.
 */
@Composable
fun TmuxProgressBar(modifier: Modifier = Modifier, value: Float? = null, label: String? = null) {
    Column(modifier = modifier.fillMaxWidth()) {
        if (label != null) {
            Row(modifier = Modifier.fillMaxWidth()) {
                Text(
                    label,
                    color = TmuxColors.textTertiary,
                    fontFamily = TmuxFonts.sans,
                    fontSize = TmuxTextSize.xs,
                    modifier = Modifier.weight(1f),
                )
                if (value != null) {
                    Text(
                        "${value.coerceIn(0f, PROGRESS_MAX_PERCENT).toInt()}%",
                        color = TmuxColors.textTertiary,
                        fontFamily = TmuxFonts.mono,
                        fontSize = TmuxTextSize.xs,
                        textAlign = TextAlign.End,
                    )
                }
            }
        }
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxWidth()
                .height(4.dp)
                .clip(RoundedCornerShape(TmuxRadius.full))
                .background(TmuxColors.bgOverlay),
        ) {
            if (value == null) {
                IndeterminateSweep(trackWidth = maxWidth)
            } else {
                Box(
                    Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(value.coerceIn(0f, PROGRESS_MAX_PERCENT) / PROGRESS_MAX_PERCENT)
                        .background(TmuxColors.accent, RoundedCornerShape(TmuxRadius.full)),
                )
            }
        }
    }
}

@Composable
private fun IndeterminateSweep(trackWidth: Dp) {
    val transition = rememberInfiniteTransition()
    // Mirrors the CSS keyframe (`left: -40% -> 100%`) as a fraction of the track width.
    val position by transition.animateFloat(
        SWEEP_START_FRACTION,
        1f,
        infiniteRepeatable(tween(SWEEP_DURATION_MS), RepeatMode.Restart),
    )
    Box(
        Modifier
            .offset(x = trackWidth * position)
            .width(trackWidth * SWEEP_WIDTH_FRACTION)
            .fillMaxHeight()
            .background(TmuxColors.accent, RoundedCornerShape(TmuxRadius.full)),
    )
}
