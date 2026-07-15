package com.tanyudii.tmuxweb.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Color tokens ported 1:1 from the tmux-web design system handoff
 * (`tokens/colors.css`). Dark, terminal-first — this app has one deliberate
 * theme, not a light/dark pair, so these are plain top-level values rather
 * than a `LightColorScheme`/`DarkColorScheme` switch.
 */
object TmuxColors {
    // Base palette — cool near-black surface ramp.
    val gray950 = Color(0xFF0B0E14)
    val gray900 = Color(0xFF10141C)
    val gray850 = Color(0xFF151A23)
    val gray800 = Color(0xFF1B212C)
    val gray750 = Color(0xFF222936)
    val gray700 = Color(0xFF2B3341)
    val gray600 = Color(0xFF3A4353)
    val gray500 = Color(0xFF4D5768)
    val gray400 = Color(0xFF6B7688)
    val gray300 = Color(0xFF9AA4B6)
    val gray200 = Color(0xFFC4CBD8)
    val gray100 = Color(0xFFE6E9EF)
    val gray050 = Color(0xFFF4F6FA)

    // Brand accent — terminal green.
    val green400 = Color(0xFF55E3A3)
    val green500 = Color(0xFF3ECF8E)
    val green600 = Color(0xFF2FB377)
    val green700 = Color(0xFF248A5C)
    val greenGlow = Color(0xFF3ECF8E).copy(alpha = 0.14f)

    // Semantic hues.
    val red500 = Color(0xFFF4685F)
    val red600 = Color(0xFFD8483F)
    val redGlow = Color(0xFFF4685F).copy(alpha = 0.13f)
    val amber500 = Color(0xFFE2B04A)
    val amber600 = Color(0xFFC8963A)
    val amberGlow = Color(0xFFE2B04A).copy(alpha = 0.13f)
    val blue500 = Color(0xFF5AA9F0)
    val blue600 = Color(0xFF3F8FDB)
    val blueGlow = Color(0xFF5AA9F0).copy(alpha = 0.13f)
    val violet500 = Color(0xFFA78BFA)
    val violetGlow = Color(0xFFA78BFA).copy(alpha = 0.13f)

    // Surfaces.
    val bgApp = gray950
    val bgSurface = gray900
    val bgRaised = gray850
    val bgCard = gray800
    val bgOverlay = gray750
    val bgHover = Color.White.copy(alpha = 0.04f)
    val bgActive = Color.White.copy(alpha = 0.07f)
    val bgTerminal = Color(0xFF080A0F)
    val scrim = Color(0xFF06080C).copy(alpha = 0.66f)

    // Borders.
    val borderSubtle = gray800
    val borderDefault = gray700
    val borderStrong = gray600
    val borderFocus = green500

    // Text.
    val textPrimary = gray100
    val textSecondary = gray300
    val textTertiary = gray400
    val textDisabled = gray500
    val textOnAccent = Color(0xFF06210F)
    val textLink = blue500

    // Interactive accent.
    val accent = green500
    val accentHover = green400
    val accentPress = green600
    val accentFill = greenGlow

    // Status — connection.
    val statusConnected = green500
    val statusDisconnected = red500
    val statusReconnecting = amber500
    val statusAttached = violet500
    val statusIdle = gray400

    // Status — git diff.
    val gitStaged = green500
    val gitUnstaged = amber500
    val gitUntracked = blue500
    val gitAdded = green500
    val gitAddedBg = Color(0xFF3ECF8E).copy(alpha = 0.10f)
    val gitRemoved = red500
    val gitRemovedBg = Color(0xFFF4685F).copy(alpha = 0.10f)
}
