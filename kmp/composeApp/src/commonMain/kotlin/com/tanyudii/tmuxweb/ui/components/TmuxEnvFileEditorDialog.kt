package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.tanyudii.tmuxweb.domain.model.EnvFile
import com.tanyudii.tmuxweb.presentation.EnvFileEditorUiState
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxMonoSize
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

private const val DIALOG_WIDTH_FRACTION = 0.7f
private const val DIALOG_HEIGHT_FRACTION = 0.8f

/**
 * Editor for a session's `.tmux-web-env/` files (docker-compose.yml,
 * pre-run.sh, post-run.sh, env.json) -- EMB-210. Saving never restarts a
 * running environment; the caller must explicitly re-run Setup for a
 * change to take effect, same as editing these files by hand always did.
 */
@Composable
fun TmuxEnvFileEditorDialog(
    state: EnvFileEditorUiState,
    onDismiss: () -> Unit,
    onSelectFile: (String) -> Unit,
    onDraftChange: (String) -> Unit,
    onSave: () -> Unit,
) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            modifier = Modifier
                .fillMaxWidth(DIALOG_WIDTH_FRACTION)
                .fillMaxHeight(DIALOG_HEIGHT_FRACTION)
                .background(TmuxColors.bgCard, RoundedCornerShape(TmuxRadius.lg)),
        ) {
            EditorHeader(onDismiss)
            if (state.files.isNotEmpty()) {
                FileTabs(state.files, state.selectedFilename, onSelectFile)
            }
            state.errorMessage?.let { EditorErrorBanner(it) }
            state.savedFilename?.let { EditorSavedBanner(it) }
            Box(modifier = Modifier.weight(1f).fillMaxWidth().padding(16.dp)) {
                when {
                    state.isLoading -> CenteredMessage("Loading…")
                    state.files.isEmpty() -> CenteredMessage("No .tmux-web-env/ files for this session.")
                    else -> EditorTextField(state.draftContent, onDraftChange)
                }
            }
            EditorFooter(isSaving = state.isSaving, canSave = state.selectedFilename != null, onSave = onSave)
        }
    }
}

@Composable
private fun EditorHeader(onDismiss: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 16.dp),
    ) {
        TmuxIconButton(
            icon = TmuxIcons.Close,
            contentDescription = "Close editor",
            onClick = onDismiss,
            size = TmuxIconButtonSize.SM,
        )
        Text(
            ".tmux-web-env",
            color = TmuxColors.textPrimary,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxTextSize.sm,
            fontWeight = TmuxWeight.semibold,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun FileTabs(files: List<EnvFile>, selected: String?, onSelectFile: (String) -> Unit) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
    ) {
        files.forEach { file ->
            val isSelected = file.filename == selected
            Text(
                file.filename,
                color = if (isSelected) TmuxColors.textPrimary else TmuxColors.textTertiary,
                fontFamily = TmuxFonts.mono,
                fontSize = TmuxTextSize.xs,
                fontWeight = if (isSelected) TmuxWeight.semibold else TmuxWeight.medium,
                modifier = Modifier
                    .background(
                        if (isSelected) TmuxColors.bgRaised else TmuxColors.bgSurface,
                        RoundedCornerShape(TmuxRadius.sm),
                    )
                    .clickable { onSelectFile(file.filename) }
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            )
        }
    }
}

@Composable
private fun EditorErrorBanner(message: String) {
    Text(
        message,
        color = TmuxColors.red500,
        fontFamily = TmuxFonts.mono,
        fontSize = TmuxTextSize.xs,
        modifier = Modifier
            .fillMaxWidth()
            .background(TmuxColors.redGlow)
            .padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
private fun EditorSavedBanner(filename: String) {
    Text(
        "Saved $filename. Re-run Setup for the running environment to pick up the change.",
        color = TmuxColors.green500,
        fontFamily = TmuxFonts.sans,
        fontSize = TmuxTextSize.xs,
        modifier = Modifier
            .fillMaxWidth()
            .background(TmuxColors.greenGlow)
            .padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
private fun CenteredMessage(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, color = TmuxColors.textTertiary, fontFamily = TmuxFonts.sans, fontSize = TmuxTextSize.sm)
    }
}

@Composable
private fun EditorTextField(content: String, onChange: (String) -> Unit) {
    BasicTextField(
        value = content,
        onValueChange = onChange,
        textStyle = TextStyle(
            color = TmuxColors.textPrimary,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxMonoSize.base,
        ),
        cursorBrush = SolidColor(TmuxColors.accent),
        modifier = Modifier
            .fillMaxSize()
            .background(TmuxColors.bgTerminal, RoundedCornerShape(TmuxRadius.sm))
            .border(1.dp, TmuxColors.borderDefault, RoundedCornerShape(TmuxRadius.sm))
            .padding(12.dp),
    )
}

@Composable
private fun EditorFooter(isSaving: Boolean, canSave: Boolean, onSave: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.End) {
        TmuxButton(
            onClick = onSave,
            text = "Save",
            variant = TmuxButtonVariant.PRIMARY,
            enabled = canSave && !isSaving,
            loading = isSaving,
        )
    }
}
