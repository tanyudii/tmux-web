package com.tanyudii.tmuxweb.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.presentation.ProjectListUiState
import com.tanyudii.tmuxweb.ui.components.TmuxSheet
import com.tanyudii.tmuxweb.ui.components.TmuxTextField
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize

/** "New Project" form sheet — ports `ui_kits/ios/app.jsx`'s `addProject` sheet. */
@Composable
fun NewProjectSheet(
    state: ProjectListUiState.NewProjectUiState,
    onSave: (name: String, repoPath: String) -> Unit,
    onCancel: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var repoPath by remember { mutableStateOf("") }

    TmuxSheet(
        title = "New Project",
        actionLabel = "Add",
        actionEnabled = !state.isSaving && name.isNotBlank(),
        onDismiss = onCancel,
        onAction = { onSave(name, repoPath) },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            TmuxTextField(
                value = name,
                onValueChange = { name = it },
                label = "Name",
                placeholder = "api-gateway",
                enabled = !state.isSaving,
            )
            TmuxTextField(
                value = repoPath,
                onValueChange = { repoPath = it },
                label = "Repo path",
                placeholder = "~/srv/api-gateway",
                mono = true,
                icon = TmuxIcons.Folder,
                enabled = !state.isSaving,
            )
            state.errorMessage?.let { message ->
                Text(message, color = TmuxColors.red500, fontFamily = TmuxFonts.sans, fontSize = TmuxTextSize.sm)
            }
        }
    }
}
