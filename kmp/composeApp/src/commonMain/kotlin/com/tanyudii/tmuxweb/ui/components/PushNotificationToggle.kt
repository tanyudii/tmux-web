package com.tanyudii.tmuxweb.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import com.tanyudii.tmuxweb.domain.repository.PushNotificationRepository
import com.tanyudii.tmuxweb.presentation.PushNotificationViewModel
import com.tanyudii.tmuxweb.ui.theme.TmuxIcons
import org.koin.compose.koinInject

/**
 * "Enable push notifications" bell toggle -- see WebMainPane's TopBar. Owns
 * its own [PushNotificationViewModel] rather than taking one as a param
 * (matching TmuxEnvironmentMenu's self-contained style) since nothing else
 * in the tree needs its state. Hidden entirely (renders nothing) when the
 * platform can't do browser push at all (iOS/JVM, or a Web browser without
 * Notification/PushManager support) -- there's nothing a disabled bell icon
 * would communicate that's worth the visual clutter.
 */
@Composable
fun PushNotificationToggle() {
    val repository: PushNotificationRepository = koinInject()
    val scope = rememberCoroutineScope()
    val viewModel = remember { PushNotificationViewModel(repository, scope) }
    val state by viewModel.state.collectAsState()

    if (!state.isSupported) return

    TmuxIconButton(
        icon = if (state.isEnabled) TmuxIcons.Bell else TmuxIcons.BellOff,
        contentDescription = if (state.isEnabled) "Disable push notifications" else "Enable push notifications",
        onClick = viewModel::toggle,
        variant = if (state.isEnabled) TmuxIconButtonVariant.FILLED else TmuxIconButtonVariant.GHOST,
    )
}
