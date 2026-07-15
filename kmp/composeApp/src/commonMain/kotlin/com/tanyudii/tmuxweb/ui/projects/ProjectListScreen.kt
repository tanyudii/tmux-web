package com.tanyudii.tmuxweb.ui.projects

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
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import com.tanyudii.tmuxweb.domain.model.Project
import com.tanyudii.tmuxweb.domain.repository.ProjectsRepository
import com.tanyudii.tmuxweb.presentation.ProjectListUiState
import com.tanyudii.tmuxweb.presentation.ProjectListViewModel
import org.koin.compose.koinInject

@Composable
fun ProjectListRoute(onOpenProject: (Project) -> Unit, onSwitchServer: () -> Unit) {
    val repository: ProjectsRepository = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember { ProjectListViewModel(repository, scope) }
    val state by viewModel.state.collectAsState()

    ProjectListScreen(
        state = state,
        viewModel = viewModel,
        onOpenProject = onOpenProject,
        onSwitchServer = onSwitchServer,
    )

    state.newProject?.let { newProjectState ->
        NewProjectSheet(
            state = newProjectState,
            onSave = viewModel::createProject,
            onCancel = viewModel::cancelNewProject,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProjectListScreen(
    state: ProjectListUiState,
    viewModel: ProjectListViewModel,
    onOpenProject: (Project) -> Unit,
    onSwitchServer: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Projects") },
                actions = {
                    TextButton(onClick = onSwitchServer) { Text("Switch Server") }
                    TextButton(onClick = viewModel::showNewProjectSheet) { Text("New Project") }
                },
            )
        },
    ) { padding ->
        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
            items(state.projects, key = { it.id }) { project ->
                ListItem(
                    headlineContent = { Text(project.name) },
                    supportingContent = { Text(project.repoPath) },
                    modifier = Modifier.clickable { onOpenProject(project) },
                    trailingContent = {
                        TextButton(onClick = { viewModel.delete(project) }) { Text("Delete") }
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
