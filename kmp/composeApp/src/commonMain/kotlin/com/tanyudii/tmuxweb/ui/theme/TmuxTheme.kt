package com.tanyudii.tmuxweb.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle

private val tmuxColorScheme = darkColorScheme(
    primary = TmuxColors.accent,
    onPrimary = TmuxColors.textOnAccent,
    primaryContainer = TmuxColors.greenGlow,
    onPrimaryContainer = TmuxColors.accent,
    secondary = TmuxColors.blue500,
    onSecondary = TmuxColors.textOnAccent,
    background = TmuxColors.bgApp,
    onBackground = TmuxColors.textPrimary,
    surface = TmuxColors.bgSurface,
    onSurface = TmuxColors.textPrimary,
    surfaceVariant = TmuxColors.bgCard,
    onSurfaceVariant = TmuxColors.textSecondary,
    surfaceContainer = TmuxColors.bgRaised,
    surfaceContainerHigh = TmuxColors.bgCard,
    surfaceContainerHighest = TmuxColors.bgOverlay,
    error = TmuxColors.red500,
    onError = TmuxColors.textOnAccent,
    errorContainer = TmuxColors.redGlow,
    onErrorContainer = TmuxColors.red500,
    outline = TmuxColors.borderDefault,
    outlineVariant = TmuxColors.borderSubtle,
    scrim = TmuxColors.scrim,
)

private val tmuxTypography = Typography().let { base ->
    base.copy(
        bodyLarge = base.bodyLarge.merge(TextStyle(fontFamily = TmuxFonts.sans)),
        bodyMedium = base.bodyMedium.merge(TextStyle(fontFamily = TmuxFonts.sans)),
        bodySmall = base.bodySmall.merge(TextStyle(fontFamily = TmuxFonts.sans)),
        titleLarge = base.titleLarge.merge(TextStyle(fontFamily = TmuxFonts.sans)),
        titleMedium = base.titleMedium.merge(TextStyle(fontFamily = TmuxFonts.sans)),
        titleSmall = base.titleSmall.merge(TextStyle(fontFamily = TmuxFonts.sans)),
        labelLarge = base.labelLarge.merge(TextStyle(fontFamily = TmuxFonts.sans)),
        labelMedium = base.labelMedium.merge(TextStyle(fontFamily = TmuxFonts.sans)),
        labelSmall = base.labelSmall.merge(TextStyle(fontFamily = TmuxFonts.sans)),
    )
}

/**
 * The app's single theme — dark, terminal-first, no light variant (see
 * `TmuxColor.kt`). Wraps [MaterialTheme] with the design-system palette
 * mapped onto Material3's color-scheme slots so every existing screen
 * (still reading `MaterialTheme.colorScheme.*` directly) picks up the
 * tmux-web look for free, while new screens use [TmuxColors]/[TmuxSpacing]/
 * [TmuxRadius] tokens directly for pixel-accurate fidelity to the handoff.
 */
@Composable
fun TmuxWebTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = tmuxColorScheme, typography = tmuxTypography, content = content)
}
