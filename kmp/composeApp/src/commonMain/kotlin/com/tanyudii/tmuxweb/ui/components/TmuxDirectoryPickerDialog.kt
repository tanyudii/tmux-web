package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.tanyudii.tmuxweb.domain.model.DirectoryEntry
import com.tanyudii.tmuxweb.presentation.DirectoryPickerUiState
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

private const val DIALOG_WIDTH_DP = 480
private const val LIST_MAX_HEIGHT_DP = 320
private const val MAX_PATH_DISPLAY_LENGTH = 44

/** Keeps the tail of the path visible (the most relevant part) instead of the default end-ellipsis. */
private fun truncatePathForDisplay(path: String): String =
    if (path.length <= MAX_PATH_DISPLAY_LENGTH) path else "…" + path.takeLast(MAX_PATH_DISPLAY_LENGTH - 1)

/**
 * "Choose a folder" modal for the New Project dialog's repo-path field —
 * ports the old iOS DirectoryBrowserView.swift's navigation model
 * (up/down through GET /api/browse) using the existing Tmux* design tokens.
 * A dumb composable: all state comes from [state], all actions are
 * callbacks — the caller owns the [com.tanyudii.tmuxweb.presentation.DirectoryPickerViewModel].
 */
@Composable
fun TmuxDirectoryPickerDialog(
    state: DirectoryPickerUiState,
    onOpen: (DirectoryEntry) -> Unit,
    onUp: () -> Unit,
    onRetry: () -> Unit,
    onConfirm: (String) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Dialog(onDismissRequest = onCancel) {
        Column(
            modifier = modifier
                .width(DIALOG_WIDTH_DP.dp)
                .background(TmuxColors.bgCard, RoundedCornerShape(TmuxRadius.lg))
                .padding(20.dp),
        ) {
            DirectoryPickerHeader(onCancel = onCancel)
            DirectoryPickerPathRow(
                path = state.currentPath,
                canGoUp = state.parentPath != null,
                onUp = onUp,
            )
            DirectoryPickerContent(state = state, onOpen = onOpen, onRetry = onRetry)
            if (state.truncated) {
                Text(
                    "Showing the first entries only — this folder has more.",
                    color = TmuxColors.textTertiary,
                    fontFamily = TmuxFonts.sans,
                    fontSize = TmuxTextSize.xs,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            DirectoryPickerFooter(
                canConfirm = state.isCurrentGitRepo && state.currentPath != null,
                onConfirm = { state.currentPath?.let(onConfirm) },
                onCancel = onCancel,
            )
        }
    }
}

@Composable
private fun DirectoryPickerHeader(onCancel: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Box(
            modifier = Modifier
                .size(32.dp)
                .background(TmuxColors.accentFill, RoundedCornerShape(TmuxRadius.sm)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                TmuxIcons.Folder,
                contentDescription = null,
                tint = TmuxColors.accent,
                modifier = Modifier.size(18.dp),
            )
        }
        Text(
            "Choose a folder",
            color = TmuxColors.textPrimary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.md,
            fontWeight = TmuxWeight.semibold,
            modifier = Modifier.padding(start = 10.dp).weight(1f),
        )
        TmuxIconButton(
            icon = TmuxIcons.Close,
            contentDescription = "Cancel",
            onClick = onCancel,
            size = TmuxIconButtonSize.SM,
        )
    }
}

@Composable
private fun DirectoryPickerPathRow(path: String?, canGoUp: Boolean, onUp: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 8.dp),
    ) {
        TmuxIconButton(
            icon = TmuxIcons.ArrowLeft,
            contentDescription = "Up one level",
            onClick = onUp,
            enabled = canGoUp,
            size = TmuxIconButtonSize.SM,
        )
        Text(
            path?.let(::truncatePathForDisplay) ?: "…",
            color = TmuxColors.textSecondary,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxTextSize.sm,
            maxLines = 1,
            modifier = Modifier.padding(start = 8.dp),
        )
    }
}

@Composable
private fun DirectoryPickerContent(
    state: DirectoryPickerUiState,
    onOpen: (DirectoryEntry) -> Unit,
    onRetry: () -> Unit,
) {
    Box(modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp, max = LIST_MAX_HEIGHT_DP.dp)) {
        when {
            state.isLoading && state.currentPath == null -> CenteredHint {
                SpinningIcon(TmuxIcons.Spinner, 20.dp, TmuxColors.textTertiary)
            }
            state.errorMessage != null -> CenteredHint {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        TmuxIcons.Alert,
                        contentDescription = null,
                        tint = TmuxColors.red500,
                        modifier = Modifier.size(20.dp),
                    )
                    Text(
                        state.errorMessage,
                        color = TmuxColors.red500,
                        fontFamily = TmuxFonts.sans,
                        fontSize = TmuxTextSize.sm,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    TmuxButton(
                        onClick = onRetry,
                        text = "Retry",
                        variant = TmuxButtonVariant.GHOST,
                        icon = TmuxIcons.Refresh,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
            }
            state.entries.isEmpty() -> CenteredHint {
                Text(
                    "No subfolders here.",
                    color = TmuxColors.textTertiary,
                    fontFamily = TmuxFonts.sans,
                    fontSize = TmuxTextSize.sm,
                )
            }
            else -> LazyColumn(modifier = Modifier.fillMaxWidth()) {
                items(state.entries, key = { it.path }) { entry ->
                    DirectoryEntryRow(entry = entry, onClick = { onOpen(entry) })
                }
            }
        }
    }
}

@Composable
private fun CenteredHint(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
        content()
    }
}

@Composable
private fun DirectoryEntryRow(entry: DirectoryEntry, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 10.dp),
    ) {
        Icon(
            TmuxIcons.Folder,
            contentDescription = null,
            tint = TmuxColors.textTertiary,
            modifier = Modifier.size(16.dp),
        )
        Text(
            entry.name,
            color = TmuxColors.textPrimary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.sm,
            modifier = Modifier.padding(start = 10.dp).weight(1f),
        )
        if (entry.isGitRepo) {
            TmuxStatusBadge(text = "git", tone = TmuxStatusTone.STAGED, mono = true)
        }
    }
}

@Composable
private fun DirectoryPickerFooter(canConfirm: Boolean, onConfirm: () -> Unit, onCancel: () -> Unit) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
    ) {
        TmuxButton(onClick = onCancel, text = "Cancel", variant = TmuxButtonVariant.GHOST)
        TmuxButton(
            onClick = onConfirm,
            text = "Use this folder",
            variant = TmuxButtonVariant.PRIMARY,
            icon = TmuxIcons.Check,
            enabled = canConfirm,
        )
    }
}
