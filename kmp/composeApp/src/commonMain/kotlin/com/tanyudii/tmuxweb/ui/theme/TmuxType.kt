package com.tanyudii.tmuxweb.ui.theme

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * Type tokens ported from `tokens/fonts.css`/`tokens/typography.css`. The
 * design system's intended families are IBM Plex Sans (UI) + IBM Plex Mono
 * (terminal/paths/counts) loaded from Google Fonts — the handoff itself
 * flags these as CDN-loaded, not self-hosted (see its README "Caveats").
 * This app bundles no font files yet, so [sans]/[mono] fall back to the
 * platform system families; swap them for `Font(Res.font.ibm_plex_*)`
 * once `.ttf`s are added under composeResources/font/ — every call site
 * already reads through these two tokens, so that's a one-file change.
 */
object TmuxFonts {
    val sans: FontFamily = FontFamily.SansSerif
    val mono: FontFamily = FontFamily.Monospace
}

/** UI scale, 11->38px (`--text-2xs` … `--text-3xl`). */
object TmuxTextSize {
    val xs2 = 11.sp
    val xs = 12.sp
    val sm = 13.sp
    val base = 15.sp
    val md = 17.sp
    val lg = 20.sp
    val xl = 24.sp
    val xl2 = 30.sp
    val xl3 = 38.sp
}

/** Terminal/mono scale, 11->16px (`--mono-xs` … `--mono-lg`). */
object TmuxMonoSize {
    val xs = 11.sp
    val sm = 12.sp
    val base = 13.sp
    val md = 14.sp
    val lg = 16.sp
}

object TmuxWeight {
    val regular = FontWeight.W400
    val medium = FontWeight.W500
    val semibold = FontWeight.W600
    val bold = FontWeight.W700
}

/** Letter spacing, expressed in em to match the CSS tokens directly. */
object TmuxTracking {
    val tight: TextUnit = (-0.01).em
    val normal: TextUnit = 0.em
    val wide: TextUnit = 0.02.em
    val caps: TextUnit = 0.06.em
}

/** Line-height ratios (`--leading-*`) — multiply by font size at the call site. */
object TmuxLeading {
    const val TIGHT = 1.2f
    const val SNUG = 1.35f
    const val NORMAL = 1.5f
    const val TERMINAL = 1.45f
}
