package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxTracking

/**
 * iOS grouped-inset-list container — ports `ui_kits/ios/chrome.jsx`'s
 * `Group`. An optional uppercase eyebrow [header] above and a helper
 * [footer] line below a bordered, `xl`-radius `bg-card` panel. Rows inside
 * (typically [TmuxListRow]) own their own dividers/heights; this only
 * supplies the card chrome.
 */
@Composable
fun TmuxGroup(
    modifier: Modifier = Modifier,
    header: String? = null,
    footer: String? = null,
    content: @Composable () -> Unit,
) {
    Column(modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        if (header != null) {
            Text(
                header.uppercase(),
                color = TmuxColors.textTertiary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.sm,
                letterSpacing = TmuxTracking.wide,
                modifier = Modifier.padding(start = 6.dp, bottom = 7.dp),
            )
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(TmuxRadius.xl))
                .background(TmuxColors.bgCard)
                .border(1.dp, TmuxColors.borderSubtle, RoundedCornerShape(TmuxRadius.xl)),
            content = { content() },
        )
        if (footer != null) {
            Text(
                footer,
                color = TmuxColors.textTertiary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.sm,
                modifier = Modifier.padding(start = 6.dp, top = 7.dp),
            )
        }
    }
}

/** Hairline divider between rows inside a [TmuxGroup] — matches the JSX's `borderTop` on all but the first row. */
@Composable
fun TmuxGroupDivider() {
    HorizontalDivider(color = TmuxColors.borderSubtle, thickness = 1.dp)
}
