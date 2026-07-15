package com.tanyudii.tmuxweb.ui.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.domain.model.Project
import com.tanyudii.tmuxweb.domain.repository.ProjectsRepository
import com.tanyudii.tmuxweb.presentation.ProjectListUiState
import com.tanyudii.tmuxweb.presentation.ProjectListViewModel
import com.tanyudii.tmuxweb.ui.components.TmuxConfirmDialog
import com.tanyudii.tmuxweb.ui.components.TmuxErrorBanner
import com.tanyudii.tmuxweb.ui.components.TmuxGroup
import com.tanyudii.tmuxweb.ui.components.TmuxGroupDivider
import com.tanyudii.tmuxweb.ui.components.TmuxIconButton
import com.tanyudii.tmuxweb.ui.components.TmuxIconButtonSize
import com.tanyudii.tmuxweb.ui.components.TmuxListRow
import com.tanyudii.tmuxweb.ui.components.TmuxNavBar
import com.tanyudii.tmuxweb.ui.components.TmuxSwipeToDeleteRow
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
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

/** Projects list — ports `ui_kits/ios/app.jsx`'s `ProjectsScreen`. */
@Composable
private fun ProjectListScreen(
    state: ProjectListUiState,
    viewModel: ProjectListViewModel,
    onOpenProject: (Project) -> Unit,
    onSwitchServer: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize().background(TmuxColors.bgSurface)) {
        ProjectListNavBar(onSwitchServer = onSwitchServer, onAddProject = viewModel::showNewProjectSheet)
        state.errorMessage?.let { message ->
            TmuxErrorBanner(message = message, onDismiss = viewModel::dismissError)
        }
        ProjectsListContent(
            state = state,
            viewModel = viewModel,
            onOpenProject = onOpenProject,
            modifier = Modifier.weight(1f),
        )
    }

    state.pendingForceDelete?.let { pending ->
        TmuxConfirmDialog(
            title = "Delete project?",
            message = pending.message,
            force = true,
            onConfirm = viewModel::confirmForceDelete,
            onCancel = viewModel::cancelForceDelete,
        )
    }
}

/**
 * Split out of [ProjectListScreen] purely to keep that composable's line
 * count under the project's threshold — no behavior change.
 */
@Composable
private fun ProjectListNavBar(onSwitchServer: () -> Unit, onAddProject: () -> Unit) {
    TmuxNavBar(
        title = "Projects",
        large = true,
        leading = {
            // No "switch server"/log-out affordance in the handoff's static mockup
            // (out of scope for a design prototype) — this is the root screen of the
            // mobile drill-down, so its otherwise-empty leading nav-bar rail is the
            // natural HIG home for it (mirrors e.g. Settings/Reminders' root screens).
            TmuxIconButton(
                icon = TmuxIcons.Settings,
                contentDescription = "Switch server",
                size = TmuxIconButtonSize.LG,
                onClick = onSwitchServer,
            )
        },
        right = {
            TmuxIconButton(
                icon = TmuxIcons.Plus,
                contentDescription = "Add project",
                size = TmuxIconButtonSize.LG,
                onClick = onAddProject,
            )
        },
    )
}

/**
 * Split out of [ProjectListScreen] purely to keep that composable's line
 * count under the project's threshold — no behavior change.
 */
@Composable
private fun ProjectsListContent(
    state: ProjectListUiState,
    viewModel: ProjectListViewModel,
    onOpenProject: (Project) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.verticalScroll(rememberScrollState()).padding(top = 12.dp)) {
        if (state.projects.isEmpty() && !state.isLoading) {
            EmptyProjectsState()
            return@Column
        }
        TmuxGroup {
            state.projects.forEachIndexed { index, project ->
                if (index > 0) TmuxGroupDivider()
                TmuxSwipeToDeleteRow(onDelete = { viewModel.delete(project) }) {
                    TmuxListRow(
                        title = project.name,
                        icon = TmuxIcons.Folder,
                        subtitle = project.repoPath,
                        onClick = { onOpenProject(project) },
                    )
                }
            }
        }
        Text(
            "Swipe a row left to delete. Tap to open its sessions.",
            color = TmuxColors.textTertiary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.sm,
            modifier = Modifier.padding(horizontal = 22.dp),
        )
    }
}

@Composable
private fun EmptyProjectsState() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxWidth().padding(top = 48.dp, start = 30.dp, end = 30.dp),
    ) {
        Icon(
            TmuxIcons.Folder,
            contentDescription = null,
            tint = TmuxColors.textTertiary,
            modifier = Modifier.padding(bottom = 10.dp),
        )
        Text("No projects", color = TmuxColors.textTertiary, fontFamily = TmuxFonts.sans, fontSize = TmuxTextSize.md)
        Text(
            "Tap + to add one.",
            color = TmuxColors.textTertiary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.sm,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}
