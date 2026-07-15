package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxMonoSize
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxTracking
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

/**
 * Labeled text field — ports `components/forms/Input.jsx`. `mono` switches
 * to the terminal font for paths/session names; leading icon, error/helper
 * text, focus glow border.
 */
@Composable
fun TmuxTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    mono: Boolean = false,
    error: String? = null,
    helper: String? = null,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()
    val borderColor = when {
        error != null -> TmuxColors.red500
        focused -> TmuxColors.accent
        else -> TmuxColors.borderDefault
    }
    val textStyle = TextStyle(
        color = TmuxColors.textPrimary,
        fontFamily = if (mono) TmuxFonts.mono else TmuxFonts.sans,
        fontSize = if (mono) TmuxMonoSize.base else TmuxTextSize.base,
        letterSpacing = if (mono) TmuxTracking.normal else TmuxTracking.tight,
    )

    Column(modifier = modifier.fillMaxWidth()) {
        label?.let { FieldLabel(it) }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(40.dp)
                .background(
                    if (enabled) TmuxColors.bgRaised else TmuxColors.bgSurface,
                    RoundedCornerShape(TmuxRadius.sm),
                )
                .border(1.dp, borderColor, RoundedCornerShape(TmuxRadius.sm))
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            icon?.let {
                Icon(
                    it,
                    contentDescription = null,
                    tint = TmuxColors.textTertiary,
                    modifier = Modifier.size(16.dp).padding(end = 8.dp),
                )
            }
            Box {
                if (value.isEmpty() && placeholder != null) {
                    Text(placeholder, style = textStyle.copy(color = TmuxColors.textTertiary))
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    enabled = enabled,
                    singleLine = singleLine,
                    textStyle = textStyle,
                    cursorBrush = SolidColor(TmuxColors.accent),
                    interactionSource = interactionSource,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        if (error != null || helper != null) {
            SupportingText(error, helper)
        }
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(
        text,
        color = TmuxColors.textSecondary,
        fontFamily = TmuxFonts.sans,
        fontSize = TmuxTextSize.sm,
        fontWeight = TmuxWeight.medium,
        modifier = Modifier.padding(bottom = 6.dp),
    )
}

@Composable
private fun SupportingText(error: String?, helper: String?) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
        if (error != null) {
            Icon(
                TmuxIcons.Alert,
                contentDescription = null,
                tint = TmuxColors.red500,
                modifier = Modifier.size(13.dp).padding(end = 5.dp),
            )
        }
        Text(
            error ?: helper.orEmpty(),
            color = if (error != null) TmuxColors.red500 else TmuxColors.textTertiary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.xs,
        )
    }
}
