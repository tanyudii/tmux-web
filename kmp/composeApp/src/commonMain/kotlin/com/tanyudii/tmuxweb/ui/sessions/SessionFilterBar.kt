package com.tanyudii.tmuxweb.ui.sessions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.domain.SessionStatusFilter
import com.tanyudii.tmuxweb.presentation.SessionListUiState
import com.tanyudii.tmuxweb.presentation.SessionListViewModel
import com.tanyudii.tmuxweb.ui.components.TmuxButton
import com.tanyudii.tmuxweb.ui.components.TmuxButtonSize
import com.tanyudii.tmuxweb.ui.components.TmuxButtonVariant
import com.tanyudii.tmuxweb.ui.components.TmuxTextField
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons

/**
 * EMB-221: status/branch filters + the bulk-delete action bar shown above
 * and below the session list -- split out of [SessionListScreen] purely to
 * keep that file under the project's detekt TooManyFunctions threshold, no
 * behavior change. "Status" is scoped to `ProjectSession.attached` (see
 * [SessionStatusFilter]'s doc comment for why live env running/idle status
 * isn't included), "branch" is a substring match against
 * `ProjectSession.name` (which doubles as the git branch name for every
 * session).
 */
@Composable
internal fun SessionFilterBar(state: SessionListUiState, viewModel: SessionListViewModel) {
    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusFilterChip("All", SessionStatusFilter.ALL, state.statusFilter, viewModel::setStatusFilter)
            StatusFilterChip("Active", SessionStatusFilter.ACTIVE, state.statusFilter, viewModel::setStatusFilter)
            StatusFilterChip("Idle", SessionStatusFilter.IDLE, state.statusFilter, viewModel::setStatusFilter)
        }
        TmuxTextField(
            value = state.branchQuery,
            onValueChange = viewModel::setBranchQuery,
            placeholder = "Filter by branch",
            icon = TmuxIcons.GitBranch,
            mono = true,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

@Composable
private fun StatusFilterChip(
    label: String,
    value: SessionStatusFilter,
    current: SessionStatusFilter,
    onSelect: (SessionStatusFilter) -> Unit,
) {
    TmuxButton(
        onClick = { onSelect(value) },
        text = label,
        variant = if (current == value) TmuxButtonVariant.PRIMARY else TmuxButtonVariant.GHOST,
        size = TmuxButtonSize.SM,
    )
}

@Composable
internal fun BulkDeleteBar(state: SessionListUiState, viewModel: SessionListViewModel) {
    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        TmuxButton(
            onClick = viewModel.bulkDelete::requestBulkDelete,
            text = "Delete selected (${state.selectedNames.size})",
            variant = TmuxButtonVariant.DANGER_GHOST,
            size = TmuxButtonSize.SM,
            icon = TmuxIcons.Trash,
            enabled = state.selectedNames.isNotEmpty(),
        )
    }
}
