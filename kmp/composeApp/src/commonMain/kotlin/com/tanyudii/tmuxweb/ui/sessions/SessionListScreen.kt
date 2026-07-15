package com.tanyudii.tmuxweb.ui.sessions

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.domain.repository.SessionsRepository
import com.tanyudii.tmuxweb.presentation.SessionListUiState
import com.tanyudii.tmuxweb.presentation.SessionListViewModel
import org.koin.compose.koinInject

@Composable
fun SessionListRoute(projectId: String, projectName: String, onOpenSession: (ProjectSession) -> Unit) {
    val repository: SessionsRepository = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember(projectId) { SessionListViewModel(projectId, repository, scope) }
    val state by viewModel.state.collectAsState()
    var isCreateSheetOpen by remember { mutableStateOf(false) }

    SessionListScreen(
        title = projectName,
        state = state,
        viewModel = viewModel,
        onOpenSession = onOpenSession,
        onNewSessionClick = { isCreateSheetOpen = true },
    )

    if (isCreateSheetOpen || state.sessionCreation != null) {
        NewSessionSheet(
            creationState = state.sessionCreation,
            onCreate = { name -> isCreateSheetOpen = false; viewModel.createSession(name) },
            onCancel = { isCreateSheetOpen = false; viewModel.cancelSessionCreation() },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SessionListScreen(
    title: String,
    state: SessionListUiState,
    viewModel: SessionListViewModel,
    onOpenSession: (ProjectSession) -> Unit,
    onNewSessionClick: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                actions = { TextButton(onClick = onNewSessionClick) { Text("New Session") } },
            )
        },
    ) { padding ->
        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
            items(state.sessions, key = { it.name }) { session ->
                ListItem(
                    headlineContent = { Text(session.name) },
                    supportingContent = { Text(sessionCaption(session)) },
                    modifier = Modifier.clickable { onOpenSession(session) },
                    trailingContent = {
                        TextButton(onClick = { viewModel.delete(session) }) { Text("Delete") }
                    },
                )
            }
        }
    }

    state.pendingForceDelete?.let { pending ->
        AlertDialog(
            onDismissRequest = viewModel::cancelForceDelete,
            title = { Text("Force Delete?") },
            text = { Text(pending.message) },
            confirmButton = { TextButton(onClick = viewModel::confirmForceDelete) { Text("Force Delete") } },
            dismissButton = { TextButton(onClick = viewModel::cancelForceDelete) { Text("Cancel") } },
        )
    }

    state.errorMessage?.let { message ->
        AlertDialog(
            onDismissRequest = viewModel::dismissError,
            title = { Text("Error") },
            text = { Text(message, color = MaterialTheme.colorScheme.error) },
            confirmButton = { TextButton(onClick = viewModel::dismissError) { Text("OK") } },
        )
    }
}

private fun sessionCaption(session: ProjectSession): String {
    val windows = "${session.windows} window${if (session.windows == 1) "" else "s"}"
    return if (session.attached) "$windows · attached" else windows
}
