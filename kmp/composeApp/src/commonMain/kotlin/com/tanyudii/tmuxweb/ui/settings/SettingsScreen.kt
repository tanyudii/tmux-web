package com.tanyudii.tmuxweb.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.presentation.ConnectionSettingsUiState
import com.tanyudii.tmuxweb.presentation.ConnectionSettingsViewModel
import com.tanyudii.tmuxweb.ui.components.TmuxButton
import com.tanyudii.tmuxweb.ui.components.TmuxButtonSize
import com.tanyudii.tmuxweb.ui.components.TmuxGroup
import com.tanyudii.tmuxweb.ui.components.TmuxNavBar
import com.tanyudii.tmuxweb.ui.components.TmuxTextField
import com.tanyudii.tmuxweb.ui.theme.TmuxColors
import com.tanyudii.tmuxweb.ui.theme.TmuxFonts
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import com.tanyudii.tmuxweb.ui.theme.TmuxMonoSize
import com.tanyudii.tmuxweb.ui.theme.TmuxRadius

@Composable
fun SettingsRoute(viewModel: ConnectionSettingsViewModel) {
    val state by viewModel.state.collectAsState()

    SettingsScreen(
        state = state,
        onServerUrlChange = viewModel::updateServerUrlText,
        onTokenChange = viewModel::updateToken,
        onConnect = viewModel::testAndSave,
    )
}

/** Connect screen — ports `ui_kits/ios/app.jsx`'s `ConnectScreen`. */
@Composable
private fun SettingsScreen(
    state: ConnectionSettingsUiState,
    onServerUrlChange: (String) -> Unit,
    onTokenChange: (String) -> Unit,
    onConnect: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize().background(TmuxColors.bgSurface)) {
        TmuxNavBar(title = "Connect", large = true)
        Column(modifier = Modifier.fillMaxWidth().padding(top = 14.dp)) {
            Wordmark()
            TmuxGroup(
                header = "Server",
                footer = "Point at your tmux-web backend. Connection is stored securely on-device.",
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    TmuxTextField(
                        value = state.serverUrlText,
                        onValueChange = onServerUrlChange,
                        label = "Server URL",
                        mono = true,
                        icon = TmuxIcons.Server,
                        enabled = !state.isTesting,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    )
                    TmuxTextField(
                        value = state.token,
                        onValueChange = onTokenChange,
                        label = "Access token",
                        mono = true,
                        password = true,
                        placeholder = "ghp_…",
                        error = state.errorMessage,
                        helper = pasteRestrictedHelper(state),
                        enabled = !state.isTesting,
                    )
                }
            }
            Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                TmuxButton(
                    onClick = onConnect,
                    text = if (state.isTesting) "Connecting…" else "Connect",
                    size = TmuxButtonSize.LG,
                    icon = if (state.isTesting) null else TmuxIcons.Link,
                    loading = state.isTesting,
                    enabled = state.canSubmit,
                    fillWidth = true,
                )
            }
        }
    }
}

// error takes visual priority over helper (see TmuxTextField's
// SupportingText), so this only surfaces once there's no real error to show.
private fun pasteRestrictedHelper(state: ConnectionSettingsUiState): String? =
    if (state.errorMessage == null && state.pasteRestricted) {
        "Clipboard paste isn't available on this connection (needs HTTPS or localhost) — type the token instead."
    } else {
        null
    }

@Composable
private fun Wordmark() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 22.dp),
    ) {
        Box(
            modifier = Modifier.size(60.dp).background(TmuxColors.greenGlow, RoundedCornerShape(TmuxRadius.xl)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(TmuxIcons.Server, contentDescription = null, tint = TmuxColors.accent, modifier = Modifier.size(30.dp))
        }
        Text("tmux-web", color = TmuxColors.textTertiary, fontFamily = TmuxFonts.mono, fontSize = TmuxMonoSize.sm)
    }
}
