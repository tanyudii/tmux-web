package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.tanyudii.tmuxweb.domain.DiffHunk
import com.tanyudii.tmuxweb.domain.DiffRow
import com.tanyudii.tmuxweb.domain.DiffRowType
import com.tanyudii.tmuxweb.domain.SyntaxLanguage
import com.tanyudii.tmuxweb.domain.TokenKind
import com.tanyudii.tmuxweb.domain.languageForFileName
import com.tanyudii.tmuxweb.domain.tokenizeLine
import com.tanyudii.tmuxweb.presentation.DiffUiState
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize
import com.tanyudii.tmuxweb.ui.theme.TmuxWeight

private const val DIALOG_WIDTH_FRACTION = 0.85f
private const val DIALOG_HEIGHT_FRACTION = 0.85f
private const val GUTTER_WIDTH_DP = 44
private const val MARKER_WIDTH_DP = 14
private const val CHANGED_SEGMENT_ALPHA = 0.35f

/**
 * Large overlay showing one file's diff GitHub-PR-review style: a
 * line-numbered gutter, full-row add/del backgrounds, a hunk band, a +/-
 * stat bar, and word-level highlight on modified line pairs (from
 * [DiffUiState.parsedDiff]'s `segments`). A dumb composable — all state
 * comes from [state], the caller owns the [com.tanyudii.tmuxweb.presentation.DiffViewModel].
 * Ports the visual design from public/app.js's `renderDiff*` functions
 * (commit 94514e6, removed in 2d3b55c's cutover to kmp/).
 */
@Composable
fun TmuxDiffDialog(
    fileName: String,
    statusLabel: String,
    statusTone: TmuxStatusTone,
    state: DiffUiState,
    onDismiss: () -> Unit,
) {
    val language = remember(fileName) { languageForFileName(fileName) }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            modifier = Modifier
                .fillMaxWidth(DIALOG_WIDTH_FRACTION)
                .fillMaxHeight(DIALOG_HEIGHT_FRACTION)
                .background(TmuxColors.bgCard, RoundedCornerShape(TmuxRadius.lg)),
        ) {
            DiffDialogHeader(fileName, statusLabel, statusTone, onDismiss)
            DiffDialogBody(state, language, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun DiffDialogHeader(fileName: String, statusLabel: String, statusTone: TmuxStatusTone, onDismiss: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 16.dp),
    ) {
        TmuxIconButton(
            icon = TmuxIcons.Close,
            contentDescription = "Close diff",
            onClick = onDismiss,
            size = TmuxIconButtonSize.SM,
        )
        Text(
            fileName,
            color = TmuxColors.textPrimary,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxTextSize.sm,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        TmuxStatusBadge(text = statusLabel, tone = statusTone, mono = true)
    }
}

@Composable
private fun DiffDialogBody(state: DiffUiState, language: SyntaxLanguage, modifier: Modifier = Modifier) {
    Box(modifier = modifier.fillMaxWidth()) {
        when {
            state.isLoading -> CenteredDiffMessage { SpinningIcon(TmuxIcons.Spinner, 20.dp, TmuxColors.textTertiary) }
            state.errorMessage != null -> CenteredDiffMessage {
                Text(
                    state.errorMessage,
                    color = TmuxColors.red500,
                    fontFamily = TmuxFonts.sans,
                    fontSize = TmuxTextSize.sm,
                )
            }
            state.isBinary -> CenteredDiffMessage {
                Text(
                    "Binary file changed.",
                    color = TmuxColors.textTertiary,
                    fontFamily = TmuxFonts.sans,
                    fontSize = TmuxTextSize.sm,
                )
            }
            state.parsedDiff == null || state.parsedDiff.hunks.isEmpty() -> CenteredDiffMessage {
                Text(
                    "No changes to show.",
                    color = TmuxColors.textTertiary,
                    fontFamily = TmuxFonts.sans,
                    fontSize = TmuxTextSize.sm,
                )
            }
            else -> Column(Modifier.fillMaxSize()) {
                DiffStatBar(state.parsedDiff.additions, state.parsedDiff.deletions)
                DiffHunkList(state.parsedDiff.hunks, language, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun CenteredDiffMessage(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center, content = { content() })
}

private val STAT_BAR_MODIFIER = Modifier.fillMaxWidth()
    .background(TmuxColors.bgSurface)
    .padding(horizontal = 16.dp, vertical = 8.dp)

@Composable
private fun DiffStatBar(additions: Int, deletions: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = STAT_BAR_MODIFIER) {
        Text(
            "+$additions",
            color = TmuxColors.gitAdded,
            fontFamily = TmuxFonts.mono,
            fontWeight = TmuxWeight.semibold,
            fontSize = TmuxTextSize.sm,
        )
        Text(
            "−$deletions",
            color = TmuxColors.gitRemoved,
            fontFamily = TmuxFonts.mono,
            fontWeight = TmuxWeight.semibold,
            fontSize = TmuxTextSize.sm,
        )
    }
}

private val HUNK_BAND_MODIFIER = Modifier.fillMaxWidth()
    .background(TmuxColors.blueGlow)
    .padding(horizontal = 16.dp, vertical = 4.dp)

@Composable
private fun DiffHunkList(hunks: List<DiffHunk>, language: SyntaxLanguage, modifier: Modifier = Modifier) {
    LazyColumn(modifier = modifier.fillMaxWidth()) {
        hunks.forEach { hunk ->
            item {
                Text(
                    hunk.header,
                    color = TmuxColors.blue500,
                    fontFamily = TmuxFonts.mono,
                    fontSize = TmuxTextSize.xs,
                    modifier = HUNK_BAND_MODIFIER,
                )
            }
            items(hunk.lines) { line -> DiffLineRow(line, language) }
        }
    }
}

@Composable
private fun DiffLineRow(line: DiffRow, language: SyntaxLanguage) {
    val rowBg = when (line.type) {
        DiffRowType.ADD -> TmuxColors.gitAddedBg
        DiffRowType.DEL -> TmuxColors.gitRemovedBg
        else -> Color.Transparent
    }
    Row(modifier = Modifier.fillMaxWidth().background(rowBg)) {
        DiffGutter(line.oldLineNo)
        DiffGutter(line.newLineNo)
        DiffLineContent(line, language, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun DiffGutter(lineNo: Int?) {
    Text(
        lineNo?.toString().orEmpty(),
        color = TmuxColors.textTertiary,
        fontFamily = TmuxFonts.mono,
        fontSize = TmuxTextSize.xs,
        textAlign = TextAlign.End,
        modifier = Modifier.width(GUTTER_WIDTH_DP.dp).padding(horizontal = 6.dp),
    )
}

@Composable
private fun DiffLineContent(line: DiffRow, language: SyntaxLanguage, modifier: Modifier = Modifier) {
    if (line.type == DiffRowType.META) {
        Text(
            line.content,
            color = TmuxColors.textTertiary,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxTextSize.xs,
            modifier = modifier.padding(horizontal = 6.dp),
        )
        return
    }

    val marker = when (line.type) {
        DiffRowType.ADD -> "+"
        DiffRowType.DEL -> "−"
        else -> " "
    }
    val markerColor = when (line.type) {
        DiffRowType.ADD -> TmuxColors.gitAdded
        DiffRowType.DEL -> TmuxColors.gitRemoved
        else -> TmuxColors.textTertiary
    }
    Row(modifier = modifier.padding(horizontal = 6.dp)) {
        Text(
            marker,
            color = markerColor,
            fontFamily = TmuxFonts.mono,
            fontSize = TmuxTextSize.xs,
            modifier = Modifier.width(MARKER_WIDTH_DP.dp),
        )
        DiffLineText(line, language)
    }
}

/**
 * Renders one line's content. A modified line with word-level diff
 * [DiffRow.segments] keeps that highlighting as-is (the changed/unchanged
 * background is more useful there than per-token syntax color, and
 * combining both correctly -- syntax tokens can straddle a segment
 * boundary -- isn't worth the complexity); syntax highlighting via
 * [tokenizeLine] only applies to lines without segments (context lines,
 * and add/del lines with no word-level pairing) -- see EMB-206.
 */
@Composable
private fun DiffLineText(line: DiffRow, language: SyntaxLanguage) {
    val segments = line.segments
    if (segments == null) {
        val tokens = remember(line.content, language) { tokenizeLine(line.content, language) }
        Row {
            tokens.forEach { token ->
                Text(
                    token.text.ifEmpty { " " },
                    color = tokenColor(token.kind),
                    fontFamily = TmuxFonts.mono,
                    fontSize = TmuxTextSize.xs,
                )
            }
        }
        return
    }

    val changedBg = when (line.type) {
        DiffRowType.ADD -> TmuxColors.gitAdded.copy(alpha = CHANGED_SEGMENT_ALPHA)
        else -> TmuxColors.gitRemoved.copy(alpha = CHANGED_SEGMENT_ALPHA)
    }
    Row {
        segments.forEach { segment ->
            Text(
                segment.text,
                color = TmuxColors.textSecondary,
                fontFamily = TmuxFonts.mono,
                fontSize = TmuxTextSize.xs,
                modifier = if (segment.changed) Modifier.background(changedBg) else Modifier,
            )
        }
    }
}

private fun tokenColor(kind: TokenKind): Color = when (kind) {
    TokenKind.KEYWORD -> TmuxColors.violet500
    TokenKind.STRING -> TmuxColors.amber500
    TokenKind.COMMENT -> TmuxColors.textTertiary
    TokenKind.NUMBER -> TmuxColors.blue500
    TokenKind.PLAIN -> TmuxColors.textSecondary
}
