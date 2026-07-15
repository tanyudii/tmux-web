package com.tanyudii.tmuxweb.ui.sessions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.presentation.SessionCreationUiState
import com.tanyudii.tmuxweb.ui.components.TmuxProgressBar
import com.tanyudii.tmuxweb.ui.components.TmuxSheet
import com.tanyudii.tmuxweb.ui.components.TmuxTextField
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize

/**
 * "New Session" form sheet — ports `ui_kits/ios/app.jsx`'s `addSession`
 * sheet. [creationState] is null before the user submits — same
 * before-submit/local-form-state split documented on the previous
 * AlertDialog-based version of this file.
 */
@Composable
fun NewSessionSheet(
    creationState: SessionCreationUiState?,
    onCreate: (name: String) -> Unit,
    onCancel: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    val isSaving = creationState?.isSaving == true

    TmuxSheet(
        title = "New Session",
        actionLabel = if (isSaving) "…" else "Create",
        actionEnabled = !isSaving,
        onDismiss = { if (!isSaving) onCancel() },
        onAction = { onCreate(name) },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            TmuxTextField(
                value = name,
                onValueChange = { name = it },
                label = "Session name",
                placeholder = "build",
                mono = true,
                icon = TmuxIcons.Terminal,
                enabled = !isSaving,
            )
            if (isSaving) {
                TmuxProgressBar(label = creationState.progressMessage ?: "Creating session…")
            }
            creationState?.errorMessage?.let { message ->
                Text(message, color = TmuxColors.red500, fontFamily = TmuxFonts.sans, fontSize = TmuxTextSize.sm)
            }
        }
    }
}
