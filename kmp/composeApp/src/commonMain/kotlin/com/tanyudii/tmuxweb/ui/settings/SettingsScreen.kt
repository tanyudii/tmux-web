package com.tanyudii.tmuxweb.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.tanyudii.tmuxweb.presentation.ConnectionSettingsUiState
import com.tanyudii.tmuxweb.presentation.ConnectionSettingsViewModel

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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsScreen(
    state: ConnectionSettingsUiState,
    onServerUrlChange: (String) -> Unit,
    onTokenChange: (String) -> Unit,
    onConnect: () -> Unit,
) {
    Scaffold(topBar = { TopAppBar(title = { Text("Connect to tmux-web") }) }) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            OutlinedTextField(
                value = state.serverUrlText,
                onValueChange = onServerUrlChange,
                label = { Text("Server URL") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = state.token,
                onValueChange = onTokenChange,
                label = { Text("Token") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            if (state.errorMessage != null) {
                Text(state.errorMessage, color = MaterialTheme.colorScheme.error)
            }
            Button(onClick = onConnect, enabled = state.canSubmit, modifier = Modifier.fillMaxWidth()) {
                if (state.isTesting) {
                    Box(contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp))
                    }
                } else {
                    Text("Connect")
                }
            }
        }
    }
}
