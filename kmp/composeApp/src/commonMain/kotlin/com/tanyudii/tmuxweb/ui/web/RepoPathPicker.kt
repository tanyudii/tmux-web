package com.tanyudii.tmuxweb.ui.web

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
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
import com.tanyudii.tmuxweb.domain.repository.BrowseRepository
import com.tanyudii.tmuxweb.presentation.DirectoryPickerViewModel
import com.tanyudii.tmuxweb.ui.components.TmuxDirectoryPickerDialog
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight
import org.koin.compose.koinInject

/**
 * Replaces a plain free-text "repo path" `TmuxTextField` (see
 * [WebShellScreen]'s `NewProjectDialog`) — visually the same frame (label,
 * `bgRaised` field, border) but tapping it opens [RepoPathPicker] instead of
 * a keyboard, since the value is always an absolute path on the *server*'s
 * filesystem, not something worth typing by hand (see GET /api/browse,
 * ported from the old iOS DirectoryBrowserView).
 */
@Composable
fun RepoPathField(repoPath: String, onClick: () -> Unit) {
    Column {
        Text(
            "Repo path",
            color = TmuxColors.textSecondary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.sm,
            fontWeight = TmuxWeight.medium,
            modifier = Modifier.padding(bottom = 6.dp),
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(40.dp)
                .background(TmuxColors.bgRaised, RoundedCornerShape(TmuxRadius.sm))
                .clickable(onClick = onClick)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                TmuxIcons.Folder,
                contentDescription = null,
                tint = TmuxColors.textTertiary,
                modifier = Modifier.size(16.dp).padding(end = 8.dp),
            )
            Text(
                repoPath.ifEmpty { "Choose a folder…" },
                color = if (repoPath.isEmpty()) TmuxColors.textTertiary else TmuxColors.textPrimary,
                fontFamily = TmuxFonts.mono,
                fontSize = TmuxTextSize.base,
                maxLines = 1,
            )
        }
    }
}

/** Owns the [DirectoryPickerViewModel] for one picker session — see [RepoPathField]. */
@Composable
fun RepoPathPicker(onPicked: (String) -> Unit, onCancel: () -> Unit) {
    val browseRepository: BrowseRepository = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember { DirectoryPickerViewModel(browseRepository, scope) }
    val state by viewModel.state.collectAsState()

    TmuxDirectoryPickerDialog(
        state = state,
        onOpen = viewModel::open,
        onUp = viewModel::up,
        onRetry = viewModel::retry,
        onConfirm = onPicked,
        onCancel = onCancel,
    )
}
