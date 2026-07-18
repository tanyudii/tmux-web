package com.tanyudii.tmuxweb.ui.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.domain.model.ProjectSession
import com.tanyudii.tmuxweb.presentation.SessionListUiState
import com.tanyudii.tmuxweb.presentation.SessionListViewModel
import com.tanyudii.tmuxweb.ui.components.TmuxGroup
import com.tanyudii.tmuxweb.ui.components.TmuxGroupDivider
import com.tanyudii.tmuxweb.ui.components.TmuxIconButton
import com.tanyudii.tmuxweb.ui.components.TmuxIconButtonSize
import com.tanyudii.tmuxweb.ui.components.TmuxListRow
import com.tanyudii.tmuxweb.ui.components.TmuxProgressBar
import com.tanyudii.tmuxweb.ui.components.TmuxStatusBadge
import com.tanyudii.tmuxweb.ui.components.TmuxStatusTone
import com.tanyudii.tmuxweb.ui.components.TmuxSwipeToDeleteRow
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius

// Session-row rendering, split out of SessionListScreen.kt purely to keep
// that file under the project's detekt TooManyFunctions threshold -- no
// behavior change.

/**
 * EMB-222: favorited sessions render in their own group above everything
 * else -- "shown separately/more prominently" per the ticket's acceptance
 * criteria. Both groups still reflect whatever status/branch filter is
 * currently active (`sessions` is already [SessionListUiState.filteredSessions]
 * by the time it reaches here) -- favoriting only changes grouping, not
 * whether a session is visible at all.
 */
@Composable
internal fun SessionsSections(
    sessions: List<ProjectSession>,
    state: SessionListUiState,
    viewModel: SessionListViewModel,
    onOpenSession: (ProjectSession) -> Unit,
    onEditLabel: (ProjectSession) -> Unit,
) {
    val (favorites, others) = sessions.partition { it.favorite }
    if (favorites.isNotEmpty()) {
        SessionsGroup(favorites, state, viewModel, onOpenSession, onEditLabel, header = "Favorites")
    }
    if (others.isNotEmpty()) {
        val header = if (favorites.isNotEmpty()) "Sessions" else null
        SessionsGroup(others, state, viewModel, onOpenSession, onEditLabel, header)
    }
}

@Composable
private fun SessionsGroup(
    sessions: List<ProjectSession>,
    state: SessionListUiState,
    viewModel: SessionListViewModel,
    onOpenSession: (ProjectSession) -> Unit,
    onEditLabel: (ProjectSession) -> Unit,
    header: String?,
) {
    TmuxGroup(header = header) {
        sessions.forEachIndexed { index, session ->
            if (index > 0) TmuxGroupDivider()
            // Keyed by identity, not loop position: without this, deleting a
            // row shifts every row below it up by one slot, and
            // TmuxSwipeToDeleteRow's remembered `hasFired`/dismiss-animation
            // state (bound to the slot) leaks onto the session that now
            // occupies it -- its next swipe is silently vetoed.
            key(session.fullName) {
                // EMB-221: selection mode swaps swipe-to-delete for a leading
                // checkbox + tap-to-toggle -- the two gestures (swipe vs. tap
                // select) shouldn't coexist on the same row at once.
                if (state.isSelectionMode) {
                    SelectableSessionRow(session, isSelected = session.name in state.selectedNames, viewModel)
                } else {
                    TmuxSwipeToDeleteRow(onDelete = { viewModel.delete(session) }) {
                        TmuxListRow(
                            title = session.name,
                            icon = TmuxIcons.Terminal,
                            subtitle = sessionSubtitle(session),
                            trailing = {
                                SessionMetaTrailingControls(session, viewModel, onEditLabel)
                                SessionStatusTrailingBadge(session)
                            },
                            onClick = { onOpenSession(session) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SelectableSessionRow(session: ProjectSession, isSelected: Boolean, viewModel: SessionListViewModel) {
    TmuxListRow(
        title = session.name,
        icon = TmuxIcons.Terminal,
        subtitle = sessionSubtitle(session),
        leading = {
            Icon(
                if (isSelected) TmuxIcons.CheckboxChecked else TmuxIcons.CheckboxUnchecked,
                contentDescription = if (isSelected) "Selected" else "Not selected",
                tint = if (isSelected) TmuxColors.accent else TmuxColors.textTertiary,
                modifier = Modifier
                    .padding(end = 4.dp)
                    .clickable { viewModel.bulkDelete.toggleSessionSelected(session.name) },
            )
        },
        trailing = { SessionStatusTrailingBadge(session) },
        chevron = false,
        onClick = { viewModel.bulkDelete.toggleSessionSelected(session.name) },
    )
}

/**
 * EMB-222: label badge (when set) + favorite toggle + "edit label" button.
 * These are separate clickable leaf composables inside [TmuxListRow]'s
 * `trailing` row, not nested inside the row's own `onClick` -- Compose
 * routes a tap to the deepest matching pointer-input handler, so tapping
 * either icon here does NOT also fire the row's onOpenSession navigation.
 * Live-verified per this repo's CLAUDE.md (a past dialog shipped with
 * exactly this kind of click-target bug going unverified).
 */
@Composable
private fun SessionMetaTrailingControls(
    session: ProjectSession,
    viewModel: SessionListViewModel,
    onEditLabel: (ProjectSession) -> Unit,
) {
    session.label?.let { label -> TmuxStatusBadge(text = label, tone = TmuxStatusTone.INFO, mono = true) }
    val favoriteDescription = if (session.favorite) {
        "Remove ${session.name} from favorites"
    } else {
        "Add ${session.name} to favorites"
    }
    TmuxIconButton(
        icon = if (session.favorite) TmuxIcons.StarFilled else TmuxIcons.StarOutline,
        contentDescription = favoriteDescription,
        size = TmuxIconButtonSize.SM,
        onClick = { viewModel.setSessionMeta(session, session.label, !session.favorite) },
    )
    TmuxIconButton(
        icon = TmuxIcons.Edit,
        contentDescription = "Edit label for ${session.name}",
        size = TmuxIconButtonSize.SM,
        onClick = { onEditLabel(session) },
    )
}

@Composable
private fun SessionStatusTrailingBadge(session: ProjectSession) {
    TmuxStatusBadge(
        text = if (session.attached) "attached" else "detached",
        tone = if (session.attached) TmuxStatusTone.ATTACHED else TmuxStatusTone.IDLE,
        dot = session.attached,
    )
}

@Composable
internal fun CreatingSessionCard(progressMessage: String?) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .background(TmuxColors.bgCard, RoundedCornerShape(TmuxRadius.xl))
            .padding(14.dp),
    ) {
        TmuxProgressBar(label = progressMessage ?: "Creating session…")
    }
}

private fun sessionSubtitle(session: ProjectSession): String =
    "${session.windows} window${if (session.windows == 1) "" else "s"}"
