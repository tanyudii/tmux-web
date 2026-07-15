package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxSpacing
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

private val NAV_RAIL_MIN_WIDTH = 76.dp
private val BACK_CHEVRON_SIZE = 22.dp

/**
 * A back control's label and click handler as one atomic unit — bundled
 * (rather than two separate `onBack`/`backLabel` parameters, one with an
 * unused default) so a caller can't supply one without the other: every
 * call site that needs a back button was already passing both explicitly,
 * and the two that don't just omit [TmuxNavBar]'s `back` parameter
 * entirely instead of needing a meaningless label value.
 */
data class TmuxNavBarBack(val label: String, val onClick: () -> Unit)

/** One-off large-title size/tracking — the handoff hardcodes 32px/-0.02em here rather than reusing a UI-scale token. */
private val LARGE_TITLE_SIZE = 32.sp
private val LARGE_TITLE_TRACKING = (-0.02).em

/**
 * HIG-style nav bar — ports `ui_kits/ios/chrome.jsx`'s `NavBar`. `large`
 * renders the title below the 44dp bar as a big bold headline (screen
 * content scrolls underneath it, same as the handoff); non-large renders
 * it centered inline in the bar instead. The bar's translucent
 * `rgba(16,20,28,.86)` background is approximated with a plain alpha
 * overlay rather than a true `backdrop-filter: blur(20px)` — Compose
 * Multiplatform has no cross-target blur-behind-content primitive, so this
 * trades the blur for a solid tint at the same color/opacity.
 */
@Composable
fun TmuxNavBar(
    title: String,
    modifier: Modifier = Modifier,
    large: Boolean = false,
    back: TmuxNavBarBack? = null,
    leading: @Composable RowScope.() -> Unit = {},
    right: @Composable RowScope.() -> Unit = {},
) {
    Column(modifier = modifier.fillMaxWidth().background(TmuxColors.gray900.copy(alpha = 0.86f))) {
        Row(
            modifier = Modifier.fillMaxWidth().height(TmuxSpacing.iosNavBarHeight).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(modifier = Modifier.widthIn(min = NAV_RAIL_MIN_WIDTH), contentAlignment = Alignment.CenterStart) {
                if (back != null) {
                    BackControl(label = back.label, onClick = back.onClick)
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically, content = leading)
                }
            }
            if (!large) {
                Text(
                    title,
                    color = TmuxColors.textPrimary,
                    fontFamily = TmuxFonts.sans,
                    fontSize = TmuxTextSize.md,
                    fontWeight = TmuxWeight.semibold,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            } else {
                Box(modifier = Modifier.weight(1f))
            }
            Box(modifier = Modifier.widthIn(min = NAV_RAIL_MIN_WIDTH), contentAlignment = Alignment.CenterEnd) {
                Row(verticalAlignment = Alignment.CenterVertically, content = right)
            }
        }
        if (large) {
            Text(
                title,
                color = TmuxColors.textPrimary,
                fontFamily = TmuxFonts.sans,
                fontSize = LARGE_TITLE_SIZE,
                fontWeight = TmuxWeight.bold,
                letterSpacing = LARGE_TITLE_TRACKING,
                modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 2.dp, bottom = 10.dp),
            )
        }
        HorizontalDivider(color = TmuxColors.borderSubtle, thickness = 1.dp)
    }
}

@Composable
private fun BackControl(label: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.clickable(onClick = onClick).padding(4.dp),
    ) {
        Icon(
            TmuxIcons.ChevronLeft,
            contentDescription = null,
            tint = TmuxColors.accent,
            modifier = Modifier.size(BACK_CHEVRON_SIZE),
        )
        Text(label, color = TmuxColors.accent, fontFamily = TmuxFonts.sans, fontSize = TmuxTextSize.md)
    }
}
