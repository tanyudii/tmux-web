package com.tanyudii.tmuxweb.ui.sessions

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.tanyudii.tmuxweb.ui.components.TmuxSheet
import com.tanyudii.tmuxweb.ui.components.TmuxTextField
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons

/**
 * EMB-222: short free-text label editor for a single session -- same
 * [TmuxSheet]-based form pattern as [NewSessionSheet]. An empty/
 * whitespace-only label clears it (mirrors session-meta.ts's own
 * normalizeLabel), so there's no separate "Clear label" action to wire up.
 */
@Composable
fun SessionLabelSheet(
    initialLabel: String?,
    onSave: (label: String?) -> Unit,
    onCancel: () -> Unit,
) {
    var label by remember { mutableStateOf(initialLabel.orEmpty()) }

    TmuxSheet(
        title = "Session label",
        actionLabel = "Save",
        onDismiss = onCancel,
        onAction = { onSave(label.trim().ifEmpty { null }) },
    ) {
        TmuxTextField(
            value = label,
            onValueChange = { label = it },
            label = "Label",
            placeholder = "e.g. Needs review",
            icon = TmuxIcons.Edit,
        )
    }
}
