package com.tanyudii.tmuxweb.ui.web

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.domain.repository.SessionsRepository
import com.tanyudii.tmuxweb.terminal.PlatformTerminalView
import com.tanyudii.tmuxweb.ui.components.TmuxConnectionBanner
import com.tanyudii.tmuxweb.ui.components.TmuxConnectionStatus
import com.tanyudii.tmuxweb.ui.components.TmuxIconButton
import com.tanyudii.tmuxweb.ui.components.TmuxIconButtonSize
import com.tanyudii.tmuxweb.ui.terminal.TerminalSession
import com.tanyudii.tmuxweb.ui.terminal.rememberTerminalSession
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

/**
 * EMB-217: primary terminal viewport, plus (when [splitOpen]) a second
 * independent viewport side by side -- each [PlatformTerminalView] gets its
 * own half-width container via `Row` + `.weight(1f)` on both children, so
 * toggling the split resizes both at once. Each pane's own ResizeObserver
 * (see XtermJs.kt) reacts to that container-size change independently,
 * which is what keeps this safe against the known fit-addon 0x0 layout
 * race this ticket called out -- confirmed live (see EMB-217's commit).
 */
@Composable
fun TerminalArea(
    projectId: String,
    sessionFullName: String,
    sessionSlug: String,
    primaryTerminal: TerminalSession,
    terminalVisible: Boolean,
    splitOpen: Boolean,
    onSplitClosed: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val repository: SessionsRepository = koinInject()
    Row(modifier = modifier.fillMaxSize()) {
        Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
            // Exactly one primary PlatformTerminalView instance regardless
            // of splitOpen -- toggling the split only changes this
            // container's *width* (via the Row weights below), which the
            // view's own ResizeObserver reacts to; it must never be a
            // second composable instance with the same key (that's the
            // duplicate-key class of bug ChangesTree.kt already hit once
            // this session, see its groupKey() fix).
            key(sessionFullName) {
                PlatformTerminalView(
                    modifier = Modifier.fillMaxSize(),
                    onInput = primaryTerminal::onInput,
                    onBell = primaryTerminal::onBell,
                    onResize = primaryTerminal::onResize,
                    handleReady = primaryTerminal.onHandleReady,
                    isVisible = terminalVisible,
                    onScroll = primaryTerminal::onScroll,
                    // See PlatformTerminalView's captureSelection kdoc.
                    captureSelection = { runCatching { repository.pasteBuffer(projectId, sessionSlug) }.getOrNull() },
                )
            }
        }
        if (splitOpen) {
            Box(modifier = Modifier.width(1.dp).fillMaxHeight().background(TmuxColors.borderDefault))
            SplitTerminalPane(
                projectId = projectId,
                sessionFullName = sessionFullName,
                sessionSlug = sessionSlug,
                isVisible = terminalVisible,
                onClose = onSplitClosed,
                modifier = Modifier.weight(1f).fillMaxHeight(),
            )
        }
    }
}

/**
 * The split viewport itself -- a second, fully independent
 * [com.tanyudii.tmuxweb.ui.terminal.TerminalSession] attached to pane 1
 * (see TerminalSocket.connect), which the backend resolves to a linked tmux
 * session sharing the primary's windows/panes but tracking its own current
 * window (confirmed live -- see session-naming.ts's splitPaneSessionName).
 * Closing it (the X button) tears down that linked session server-side,
 * best-effort -- see SessionsRepository.closeSplitPane -- rather than just
 * disconnecting, since a split is modeled as ephemeral UI state, not a
 * persistent session the way the primary pane is.
 */
@Composable
private fun SplitTerminalPane(
    projectId: String,
    sessionFullName: String,
    sessionSlug: String,
    isVisible: Boolean,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val repository: SessionsRepository = koinInject()
    val scope = rememberCoroutineScope()
    val terminal = rememberTerminalSession(sessionFullName, pane = 1)

    Box(modifier = modifier) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth().height(32.dp)
                .background(TmuxColors.bgSurface).padding(horizontal = 8.dp),
        ) {
            Text("Split", color = TmuxColors.textTertiary, fontFamily = TmuxFonts.mono, fontSize = TmuxTextSize.xs)
            TmuxIconButton(
                icon = TmuxIcons.Close,
                contentDescription = "Close split",
                onClick = {
                    scope.launch {
                        // closeSplitPane's REST route (/api/projects/:id/sessions/:slug/split)
                        // expects the session *slug*, not the composite fullName -- confirmed
                        // live this was wrong once: the DELETE request fired and returned 204,
                        // but silently no-opped because killProjectSessionSplit computed a
                        // different (wrong) split session name from the mismatched identity,
                        // leaving the real linked tmux session running. Caught by checking
                        // `tmux list-sessions` after the UI reported the split closed.
                        runCatching { repository.closeSplitPane(projectId, sessionSlug) }
                        onClose()
                    }
                },
                size = TmuxIconButtonSize.SM,
            )
        }
        if (!terminal.isConnected) {
            TmuxConnectionBanner(
                status = TmuxConnectionStatus.RECONNECTING,
                message = "Reconnecting…",
                onRetry = terminal::onRetry,
                modifier = Modifier.fillMaxWidth().padding(top = 32.dp),
            )
        }
        Box(modifier = Modifier.fillMaxSize().padding(top = 32.dp)) {
            key(sessionFullName) {
                PlatformTerminalView(
                    modifier = Modifier.fillMaxSize(),
                    onInput = terminal::onInput,
                    onBell = terminal::onBell,
                    onResize = terminal::onResize,
                    handleReady = terminal.onHandleReady,
                    isVisible = isVisible,
                    onScroll = terminal::onScroll,
                    // See PlatformTerminalView's captureSelection kdoc.
                    captureSelection = { runCatching { repository.pasteBuffer(projectId, sessionSlug) }.getOrNull() },
                )
            }
        }
    }
}
