package com.tanyudii.tmuxweb.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing

/** Motion tokens ported from `tokens/effects.css` — durations in ms, easings as cubic beziers. */
object TmuxMotion {
    const val DURATION_FAST_MS = 120
    const val DURATION_BASE_MS = 200
    const val DURATION_SLOW_MS = 320

    val easeStandard: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val easeEmphasized: Easing = CubicBezierEasing(0.3f, 0f, 0f, 1f)
    val easeIos: Easing = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)
    val easeOut: Easing = CubicBezierEasing(0f, 0f, 0.2f, 1f)
}
