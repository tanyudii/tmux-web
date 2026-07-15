package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize

/**
 * Centered icon + title + subtitle placeholder for an empty list — was
 * duplicated near-verbatim as `EmptyProjectsState`/`EmptySessionsState`
 * before this extraction (ProjectListScreen.kt/SessionListScreen.kt).
 */
@Composable
fun TmuxEmptyState(
    icon: ImageVector,
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    titleColor: Color = TmuxColors.textTertiary,
    titleSize: TextUnit = TmuxTextSize.md,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier.fillMaxWidth().padding(top = 48.dp, start = 30.dp, end = 30.dp),
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = TmuxColors.textTertiary,
            modifier = Modifier.padding(bottom = 10.dp),
        )
        Text(title, color = titleColor, fontFamily = TmuxFonts.sans, fontSize = titleSize)
        Text(
            subtitle,
            color = TmuxColors.textTertiary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.sm,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}
