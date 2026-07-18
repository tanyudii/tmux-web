package com.tanyudii.tmuxweb.ui.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.tanyudii.tmuxweb.domain.model.ChangedFile
import com.tanyudii.tmuxweb.domain.model.DiffMode
import com.tanyudii.tmuxweb.domain.model.GroupedChanges
import com.tanyudii.tmuxweb.domain.repository.ChangesRepository
import com.tanyudii.tmuxweb.presentation.ChangesViewModel
import com.tanyudii.tmuxweb.presentation.DiffViewModel
import com.tanyudii.tmuxweb.presentation.discardConfirmMessage
import com.tanyudii.tmuxweb.ui.components.TmuxConfirmDialog
import com.tanyudii.tmuxweb.ui.components.TmuxDiffDialog
import com.tanyudii.tmuxweb.ui.components.TmuxErrorBanner
import com.tanyudii.tmuxweb.ui.components.TmuxIconButton
import com.tanyudii.tmuxweb.ui.components.TmuxIconButtonSize
import com.tanyudii.tmuxweb.ui.components.TmuxNavBar
import com.tanyudii.tmuxweb.ui.components.TmuxNavBarBack
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.web.ChangesRail
import com.tanyudii.tmuxweb.ui.web.label
import com.tanyudii.tmuxweb.ui.web.tone
import org.koin.compose.koinInject

/**
 * EMB-225: mobile/iOS counterpart to the desktop [WebShellScreen]'s
 * always-visible [ChangesRail] -- a narrow screen has no room for a
 * permanent side rail, so this opens the SAME [ChangesRail] full-screen in
 * a [Dialog] instead of duplicating its row-rendering tree. [changes] is
 * passed in (not constructed here) so [TerminalScreen] can own one
 * long-lived [ChangesViewModel] per session -- its 5s poll keeps
 * [ChangesNavButton]'s badge count fresh even while this dialog is closed,
 * rather than restarting a fresh poll (and losing the count) every time the
 * user opens it.
 */
@Composable
fun ChangesDialog(
    projectId: String,
    sessionName: String,
    changes: ChangesViewModel,
    onDismiss: () -> Unit,
) {
    val repository: ChangesRepository = koinInject()
    val scope = rememberCoroutineScope()
    val state by changes.state.collectAsState()
    var diffTarget by remember { mutableStateOf<DiffTarget?>(null) }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(modifier = Modifier.fillMaxSize().background(TmuxColors.bgSurface)) {
            TmuxNavBar(title = "Changes", back = TmuxNavBarBack(label = "Close", onClick = onDismiss))
            state.errorMessage?.let { message -> TmuxErrorBanner(message = message, onDismiss = changes::dismissError) }
            ChangesRail(
                changes = state.changes,
                onFileClick = { file, mode -> diffTarget = DiffTarget(file, mode) },
                onStage = changes::stage,
                onUnstage = changes::unstage,
                onDiscard = changes::requestDiscard,
                commitMessage = state.commitMessage,
                onCommitMessageChange = changes::updateCommitMessage,
                isCommitting = state.isCommitting,
                onCommit = changes::commit,
                modifier = Modifier.fillMaxWidth().weight(1f),
            )
        }
    }

    state.pendingDiscard?.let { pending ->
        TmuxConfirmDialog(
            title = "Discard changes?",
            message = discardConfirmMessage(pending),
            confirmLabel = "Discard",
            onConfirm = changes::confirmDiscard,
            onCancel = changes::cancelDiscard,
        )
    }

    diffTarget?.let { target ->
        val diffViewModel = remember(target) {
            DiffViewModel(projectId, sessionName, target.file.path, target.mode, repository, scope)
        }
        val diffState by diffViewModel.state.collectAsState()
        TmuxDiffDialog(
            fileName = target.file.path,
            statusLabel = target.mode.label,
            statusTone = target.mode.tone,
            state = diffState,
            onDismiss = { diffTarget = null },
        )
    }
}

/** Nav-bar entry point: git-branch icon with a badge showing the total changed-file count. */
@Composable
fun ChangesNavButton(changes: GroupedChanges?, onClick: () -> Unit) {
    val count = (changes?.staged?.size ?: 0) + (changes?.unstaged?.size ?: 0) + (changes?.untracked?.size ?: 0)
    BadgedBox(badge = { if (count > 0) Badge { Text(count.toString()) } }) {
        TmuxIconButton(
            icon = TmuxIcons.GitBranch,
            contentDescription = "Changes",
            size = TmuxIconButtonSize.LG,
            onClick = onClick,
        )
    }
}

private data class DiffTarget(val file: ChangedFile, val mode: DiffMode)
