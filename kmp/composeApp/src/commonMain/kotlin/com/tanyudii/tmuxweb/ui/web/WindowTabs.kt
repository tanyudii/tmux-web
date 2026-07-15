package com.tanyudii.tmuxweb.ui.web

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.tanyudii.tmuxweb.ui.components.TmuxButton
import com.tanyudii.tmuxweb.ui.components.TmuxButtonVariant
import com.tanyudii.tmuxweb.ui.components.TmuxConfirmDialog
import com.tanyudii.tmuxweb.ui.components.TmuxIconButton
import com.tanyudii.tmuxweb.ui.components.TmuxIconButtonSize
import com.tanyudii.tmuxweb.ui.components.TmuxTextField
import com.tanyudii.tmuxweb.ui.terminal.TerminalSession
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Switches between the session's existing tmux windows (real `Ctrl+B <digit>`
 * keystrokes -- no per-window REST endpoint exists, see [WebMainPane]'s
 * kdoc) and, via the trailing "+", creates a new one (`Ctrl+B c`). Renaming
 * and closing a window go through tmux's own `:` command line instead
 * (`rename-window`/`kill-window -t <index>`) since those aren't bound to a
 * single keystroke. [com.tanyudii.tmuxweb.domain.model.ProjectSession.windows]
 * is a one-shot snapshot (see [WebShellViewModel.refreshSessions]'s kdoc), so
 * a short delay before [onWindowsChanged] gives tmux time to actually apply
 * the change before re-fetching the count that drives this row's tab list.
 *
 * Display names come from [serverWindowNames] (the real tmux window names,
 * see [com.tanyudii.tmuxweb.domain.model.ProjectSession.windowNames] and
 * `src/tmux.ts`'s `listWindows`), with a `localOverrides` map layered on top
 * for instant optimistic feedback right after a rename/close -- before
 * [onWindowsChanged] has had a chance to re-fetch. `localOverrides` resets
 * whenever a fresh [serverWindowNames] arrives (see the `LaunchedEffect`
 * below), so the real backend-confirmed name always wins once available,
 * including after a page reload (a fresh composition starts with no
 * overrides at all, reading straight from [serverWindowNames]).
 */
@Composable
internal fun WindowTabs(
    windowCount: Int,
    activeWindow: Int,
    serverWindowNames: List<String>,
    onSelectWindow: (Int) -> Unit,
    onWindowsChanged: () -> Unit,
    terminal: TerminalSession,
    onDialogOpenChanged: (Boolean) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var localOverrides by remember { mutableStateOf<Map<Int, String>>(emptyMap()) }
    LaunchedEffect(serverWindowNames) { localOverrides = emptyMap() }
    var pendingCloseWindow by remember { mutableStateOf<Int?>(null) }
    var renamingWindow by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(pendingCloseWindow, renamingWindow) {
        onDialogOpenChanged(pendingCloseWindow != null || renamingWindow != null)
    }
    val windowNames = (0 until windowCount).associateWith { index ->
        localOverrides[index] ?: serverWindowNames.getOrNull(index) ?: "win$index"
    }

    WindowTabsRow(
        windowCount = windowCount,
        activeWindow = activeWindow,
        windowNames = windowNames,
        onSelectWindow = { index ->
            onSelectWindow(index)
            // Real tmux prefix (Ctrl+B) + window index — no per-window REST endpoint exists (see kdoc above).
            terminal.onInput(TMUX_PREFIX_CTRL_B + index.toString())
        },
        onRenameClick = { renamingWindow = it },
        onCloseClick = { pendingCloseWindow = it },
        onNewWindow = {
            onSelectWindow(windowCount) // tmux appends new windows at the end
            terminal.onInput(TMUX_PREFIX_CTRL_B + "c")
            scope.launch {
                delay(WINDOW_REFRESH_DELAY_MS)
                onWindowsChanged()
            }
        },
    )

    WindowActionDialogs(
        renamingWindow = renamingWindow,
        pendingCloseWindow = pendingCloseWindow,
        windowCount = windowCount,
        windowNames = windowNames,
        terminal = terminal,
        scope = scope,
        onLocalOverride = { index, name -> localOverrides = localOverrides + (index to name) },
        onClearOverrides = { localOverrides = emptyMap() },
        onSelectWindow = onSelectWindow,
        onWindowsChanged = onWindowsChanged,
        onRenamingWindowChanged = { renamingWindow = it },
        onPendingCloseWindowChanged = { pendingCloseWindow = it },
    )
}

/**
 * Renders the rename/close confirmation dialogs (at most one open at a
 * time). Split out of [WindowTabs] purely to keep that composable's line
 * count under the project's detekt threshold -- no behavior change.
 */
@Composable
private fun WindowActionDialogs(
    renamingWindow: Int?,
    pendingCloseWindow: Int?,
    windowCount: Int,
    windowNames: Map<Int, String>,
    terminal: TerminalSession,
    scope: CoroutineScope,
    onLocalOverride: (Int, String) -> Unit,
    onClearOverrides: () -> Unit,
    onSelectWindow: (Int) -> Unit,
    onWindowsChanged: () -> Unit,
    onRenamingWindowChanged: (Int?) -> Unit,
    onPendingCloseWindowChanged: (Int?) -> Unit,
) {
    renamingWindow?.let { index ->
        RenameWindowDialog(
            initialName = windowNames[index] ?: "win$index",
            onConfirm = { name ->
                onLocalOverride(index, name)
                onRenamingWindowChanged(null)
                scope.launch {
                    terminal.sendTmuxCommand("""rename-window -t $index "${escapeForTmuxDoubleQuotes(name)}"""")
                    delay(WINDOW_REFRESH_DELAY_MS)
                    onWindowsChanged()
                }
            },
            onCancel = { onRenamingWindowChanged(null) },
        )
    }

    pendingCloseWindow?.let { index ->
        CloseWindowDialog(
            index = index,
            isLastWindow = windowCount <= 1,
            onConfirm = {
                // Remaining windows renumber (move-window -r below), so any
                // stale index->name override could now point at the wrong
                // window -- drop all of it rather than mislabel a survivor.
                onClearOverrides()
                onSelectWindow(0)
                onPendingCloseWindowChanged(null)
                scope.launch {
                    terminal.sendTmuxCommand("kill-window -t $index ; move-window -r")
                    delay(WINDOW_REFRESH_DELAY_MS)
                    onWindowsChanged()
                }
            },
            onCancel = { onPendingCloseWindowChanged(null) },
        )
    }
}

/**
 * Sends a tmux `:` command-prompt sequence as three SEPARATE [TerminalSession.onInput]
 * calls (prefix+colon, then the command text, then a lone Enter) rather than
 * one combined string. Confirmed live (real browser + direct `tmux
 * list-windows` check on the backing session) that sending the whole
 * sequence -- including the trailing `\r` -- as a single bulk write does NOT
 * work: tmux does enter command-prompt mode, but the embedded `\r` is not
 * recognized as Enter and the prompt is left open, silently swallowing
 * whatever is typed next. Splitting the final `\r` into its own write (so it
 * lands in tmux's own separate read()) is what real per-keystroke typing
 * does naturally and is what actually submits the command.
 */
private suspend fun TerminalSession.sendTmuxCommand(command: String) {
    onInput(TMUX_PREFIX_CTRL_B + ":")
    delay(TMUX_KEYSTROKE_DELAY_MS)
    onInput(command)
    delay(TMUX_KEYSTROKE_DELAY_MS)
    onInput("\r")
}

@Composable
private fun WindowTabsRow(
    windowCount: Int,
    activeWindow: Int,
    windowNames: Map<Int, String>,
    onSelectWindow: (Int) -> Unit,
    onRenameClick: (Int) -> Unit,
    onCloseClick: (Int) -> Unit,
    onNewWindow: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(36.dp)
            .background(TmuxColors.bgTerminal)
            .padding(horizontal = 8.dp),
    ) {
        for (index in 0 until windowCount) {
            WindowTab(
                index = index,
                name = windowNames[index] ?: "win$index",
                active = index == activeWindow,
                onClick = { onSelectWindow(index) },
                onRenameClick = { onRenameClick(index) },
                onCloseClick = { onCloseClick(index) },
            )
        }
        TmuxIconButton(
            icon = TmuxIcons.Plus,
            contentDescription = "New tmux window",
            size = TmuxIconButtonSize.SM,
            onClick = onNewWindow,
        )
    }
}

@Composable
private fun WindowTab(
    index: Int,
    name: String,
    active: Boolean,
    onClick: () -> Unit,
    onRenameClick: () -> Unit,
    onCloseClick: () -> Unit,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val hovered by interactionSource.collectIsHoveredAsState()
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxHeight()
            .background(if (active) TmuxColors.bgRaised else Color.Transparent)
            .hoverable(interactionSource)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Text(
            index.toString(),
            color = if (active) TmuxColors.accent else TmuxColors.textTertiary,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxTextSize.xs,
        )
        Text(
            name,
            color = if (active) TmuxColors.textPrimary else TmuxColors.textTertiary,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxTextSize.xs,
        )
        if (hovered) {
            Icon(
                TmuxIcons.Edit,
                contentDescription = "Rename $name",
                tint = TmuxColors.textTertiary,
                modifier = Modifier.size(12.dp).clickable(onClick = onRenameClick),
            )
            Icon(
                TmuxIcons.Close,
                contentDescription = "Close $name",
                tint = TmuxColors.textTertiary,
                modifier = Modifier.size(12.dp).clickable(onClick = onCloseClick),
            )
        }
    }
}

/** Small centered dialog for the window-rename text input, styled like [TmuxConfirmDialog]. */
@Composable
private fun RenameWindowDialog(initialName: String, onConfirm: (String) -> Unit, onCancel: () -> Unit) {
    var name by remember { mutableStateOf(initialName) }
    Dialog(onDismissRequest = onCancel) {
        Column(
            modifier = Modifier
                .width(320.dp)
                .background(TmuxColors.bgCard, RoundedCornerShape(TmuxRadius.lg))
                .padding(20.dp),
        ) {
            Text(
                "Rename window",
                color = TmuxColors.textPrimary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.md,
                fontWeight = TmuxWeight.semibold,
            )
            TmuxTextField(
                value = name,
                onValueChange = { name = it },
                mono = true,
                modifier = Modifier.padding(top = 12.dp),
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            ) {
                TmuxButton(
                    onClick = onCancel,
                    text = "Cancel",
                    variant = TmuxButtonVariant.SECONDARY,
                    fillWidth = true,
                    modifier = Modifier.weight(1f),
                )
                TmuxButton(
                    onClick = { if (name.isNotBlank()) onConfirm(name) },
                    text = "Rename",
                    variant = TmuxButtonVariant.PRIMARY,
                    enabled = name.isNotBlank(),
                    fillWidth = true,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun CloseWindowDialog(index: Int, isLastWindow: Boolean, onConfirm: () -> Unit, onCancel: () -> Unit) {
    TmuxConfirmDialog(
        title = "Close win$index?",
        message = if (isLastWindow) {
            "This is the last window — closing it will end the whole tmux session."
        } else {
            "Any running process in win$index will be terminated."
        },
        confirmLabel = "Close",
        onConfirm = onConfirm,
        onCancel = onCancel,
    )
}

private val TMUX_PREFIX_CTRL_B = Char(2).toString()
private const val WINDOW_REFRESH_DELAY_MS = 400L
private const val TMUX_KEYSTROKE_DELAY_MS = 80L

private fun escapeForTmuxDoubleQuotes(value: String): String =
    value.replace("\\", "\\\\").replace("\"", "\\\"")
