package com.tanyudii.tmuxweb.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius
import com.tanyudii.tmuxweb.ui.theme.TmuxTextSize

/**
 * Global Ctrl+K/Cmd+K listener for opening the command palette (EMB-218).
 * Deliberately just a Compose `onPreviewKeyEvent` -- no `document.activeElement`
 * check needed to avoid colliding with terminal shortcuts (Ctrl+C, Ctrl+D,
 * etc reaching the shell): typing into the terminal happens on a real DOM
 * element outside Compose's own canvas/focus tree (see PlatformTerminalView),
 * so key events from there never reach a Compose `onPreviewKeyEvent` at all,
 * confirmed live -- this only ever fires when a Compose-rendered element has
 * focus. `focusable()` + an initial `requestFocus()` are what let it fire
 * with nothing else explicitly focused (e.g. right after the page loads).
 */
@Composable
fun Modifier.commandPaletteShortcut(onOpen: () -> Unit): Modifier {
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }
    return this
        .focusRequester(focusRequester)
        .focusable()
        .onPreviewKeyEvent { event -> isOpenPaletteShortcut(event).also { if (it) onOpen() } }
}

private fun isOpenPaletteShortcut(event: KeyEvent): Boolean =
    event.type == KeyEventType.KeyDown && event.key == Key.K && (event.isCtrlPressed || event.isMetaPressed)

/**
 * Ctrl+K / Cmd+K command palette (EMB-218) -- fuzzy-searches [items] by
 * [CommandPaletteItem.label] (falls back to [CommandPaletteItem.sublabel]
 * for sessions, so typing a project name still surfaces its sessions) and
 * navigates on Enter/click. [Modifier.commandPaletteShortcut] (above) is
 * what opens this from anywhere in the Web shell -- this composable only
 * owns the search/filter/keyboard-nav *within* an already-open palette.
 */
@Composable
fun TmuxCommandPalette(items: List<CommandPaletteItem>, onSelect: (CommandPaletteItem) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val selectedIndex = remember { mutableIntStateOf(0) }
    val focusRequester = remember { FocusRequester() }
    val filtered = remember(items, query) { filterAndRankItems(items, query) }

    LaunchedEffect(filtered.size) { if (selectedIndex.intValue >= filtered.size) selectedIndex.intValue = 0 }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(
            modifier = Modifier.fillMaxSize().background(TmuxColors.scrim).clickable(onClick = onDismiss),
            contentAlignment = Alignment.TopCenter,
        ) {
            PaletteCard(
                query = query,
                onQueryChange = { query = it },
                focusRequester = focusRequester,
                filtered = filtered,
                selectedIndex = selectedIndex,
                onSelect = onSelect,
                onDismiss = onDismiss,
            )
        }
    }
}

@Composable
private fun PaletteCard(
    query: String,
    onQueryChange: (String) -> Unit,
    focusRequester: FocusRequester,
    filtered: List<CommandPaletteItem>,
    selectedIndex: MutableState<Int>,
    onSelect: (CommandPaletteItem) -> Unit,
    onDismiss: () -> Unit,
) {
    Column(
        modifier = Modifier.padding(top = 96.dp).width(560.dp)
            .background(TmuxColors.bgCard, RoundedCornerShape(TmuxRadius.lg))
            // Swallows clicks so they don't fall through to the scrim's own
            // dismiss-on-click behind this card.
            .clickable(onClick = {}, indication = null, interactionSource = remember { MutableInteractionSource() }),
    ) {
        PaletteSearchField(
            query = query,
            onQueryChange = onQueryChange,
            focusRequester = focusRequester,
            onKeyEvent = { event ->
                handlePaletteKey(event, filtered, selectedIndex, onSelect, onDismiss)
            },
        )
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(TmuxColors.borderDefault))
        PaletteResults(filtered = filtered, selectedIndex = selectedIndex.value, onSelect = onSelect)
    }
}

// Not @Composable (detekt's LongParameterList exempts @Composable functions,
// but this one is deliberately plain so it stays simple/testable in
// isolation) -- kept to 5 params by folding selectedIndex's read+write into
// one MutableState instead of a separate value/setter pair.
private fun handlePaletteKey(
    event: KeyEvent,
    filtered: List<CommandPaletteItem>,
    selectedIndex: MutableState<Int>,
    onSelect: (CommandPaletteItem) -> Unit,
    onDismiss: () -> Unit,
): Boolean {
    if (event.type != KeyEventType.KeyDown) return false
    val count = filtered.size
    return when (event.key) {
        Key.Escape -> {
            onDismiss()
            true
        }
        Key.DirectionDown -> {
            if (count > 0) selectedIndex.value = (selectedIndex.value + 1) % count
            true
        }
        Key.DirectionUp -> {
            if (count > 0) selectedIndex.value = (selectedIndex.value - 1 + count) % count
            true
        }
        Key.Enter, Key.NumPadEnter -> {
            filtered.getOrNull(selectedIndex.value)?.let(onSelect)
            true
        }
        else -> false
    }
}

@Composable
private fun PaletteSearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    focusRequester: FocusRequester,
    onKeyEvent: (KeyEvent) -> Boolean,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
    ) {
        Icon(TmuxIcons.Terminal, contentDescription = null, tint = TmuxColors.textTertiary)
        Box(modifier = Modifier.width(10.dp))
        BasicTextField(
            value = query,
            onValueChange = onQueryChange,
            singleLine = true,
            textStyle = TextStyle(
                color = TmuxColors.textPrimary,
                fontFamily = TmuxFonts.sans,
                fontSize = TmuxTextSize.md,
            ),
            cursorBrush = SolidColor(TmuxColors.accent),
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 14.dp)
                .focusRequester(focusRequester)
                .onPreviewKeyEvent(onKeyEvent),
        )
    }
}

@Composable
private fun PaletteResults(
    filtered: List<CommandPaletteItem>,
    selectedIndex: Int,
    onSelect: (CommandPaletteItem) -> Unit,
) {
    if (filtered.isEmpty()) {
        Text(
            "No matches",
            color = TmuxColors.textTertiary,
            fontFamily = TmuxFonts.sans,
            fontSize = TmuxTextSize.sm,
            modifier = Modifier.padding(16.dp),
        )
        return
    }
    LazyColumn(state = rememberLazyListState(), modifier = Modifier.heightIn(max = 360.dp)) {
        items(filtered, key = { it.id }) { item ->
            CommandPaletteRow(
                item = item,
                selected = filtered.indexOf(item) == selectedIndex,
                onClick = { onSelect(item) },
            )
        }
    }
}

@Composable
private fun CommandPaletteRow(item: CommandPaletteItem, selected: Boolean, onClick: () -> Unit) {
    val icon: ImageVector = if (item is CommandPaletteItem.ProjectEntry) TmuxIcons.Folder else TmuxIcons.Terminal
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) TmuxColors.bgHover else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = TmuxColors.textTertiary)
        Column {
            Text(item.label, color = TmuxColors.textPrimary, fontFamily = TmuxFonts.mono, fontSize = TmuxTextSize.sm)
            item.sublabel?.let {
                Text(it, color = TmuxColors.textTertiary, fontFamily = TmuxFonts.sans, fontSize = TmuxTextSize.xs)
            }
        }
    }
}
