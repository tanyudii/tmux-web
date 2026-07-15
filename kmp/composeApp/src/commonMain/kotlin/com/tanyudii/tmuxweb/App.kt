package com.tanyudii.tmuxweb

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.tanyudii.tmuxweb.data.remote.ConnectionTester
import com.tanyudii.tmuxweb.di.TmuxWebSessionHolder
import com.tanyudii.tmuxweb.domain.repository.ConnectionSettingsStore
import com.tanyudii.tmuxweb.navigation.Route
import com.tanyudii.tmuxweb.presentation.ConnectionSettingsViewModel
import com.tanyudii.tmuxweb.ui.projects.ProjectListRoute
import com.tanyudii.tmuxweb.ui.sessions.SessionListRoute
import com.tanyudii.tmuxweb.ui.settings.SettingsRoute
import com.tanyudii.tmuxweb.ui.terminal.TerminalRoute
import com.tanyudii.tmuxweb.ui.theme.TmuxWebTheme
import com.tanyudii.tmuxweb.ui.web.WebShellScreen
import org.koin.compose.koinInject

/** Below this width, the mobile drill-down nav graph renders instead of the wide Web shell. */
private val DESKTOP_BREAKPOINT = 900.dp

/**
 * Top-level structure mirrors RootView.swift: two mutually exclusive roots
 * (Settings vs. the main nav graph), not one NavHost with a Settings node
 * popped off — see .claude/plans/velvet-noodling-treasure.md Stage 2.
 */
@Composable
fun App() {
    TmuxWebTheme {
        val settingsStore: ConnectionSettingsStore = koinInject()
        val connectionTester: ConnectionTester = koinInject()
        val sessionHolder: TmuxWebSessionHolder = koinInject()
        val appScope = rememberCoroutineScope()
        val settingsViewModel = remember { ConnectionSettingsViewModel(settingsStore, connectionTester, appScope) }
        val settingsState by settingsViewModel.state.collectAsState()

        // Deliberately NOT a LaunchedEffect: that dispatches its body onto a
        // coroutine that runs *after* this composition pass commits, which
        // is too late — the `when` branch below composes AdaptiveRoot's
        // children (which koinInject() factories reading this holder,
        // e.g. ProjectsRepository) in this SAME pass, the first time
        // settingsState.current flips from null to non-null. A plain
        // synchronous call here (idempotent — just publishes the latest
        // value) guarantees the holder is populated before any descendant
        // composes.
        sessionHolder.update(settingsState.current)

        when {
            !settingsState.isLoaded -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            settingsState.current == null -> SettingsRoute(viewModel = settingsViewModel)
            else -> AdaptiveRoot(onSwitchServer = settingsViewModel::clear)
        }
    }
}

/**
 * Picks the UI shape by available width, not by platform: a wide window
 * (desktop browser, iPad landscape, resized Compose Desktop) gets the
 * persistent-sidebar Web shell; anything narrower gets the mobile
 * drill-down flow. This is deliberately not gated on `wasmJs`-vs-`iOS`
 * directly — see the design-system handoff's "Web — web-friendly, not a
 * mobile port" framing, which is about the *layout*, not the runtime.
 */
@Composable
private fun AdaptiveRoot(onSwitchServer: () -> Unit) {
    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        if (maxWidth >= DESKTOP_BREAKPOINT) {
            WebShellScreen(onSwitchServer = onSwitchServer)
        } else {
            MainNavHost(onSwitchServer = onSwitchServer)
        }
    }
}

@Composable
private fun MainNavHost(onSwitchServer: () -> Unit) {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = Route.Projects) {
        composable<Route.Projects> {
            ProjectListRoute(
                onOpenProject = { project ->
                    navController.navigate(Route.Sessions(projectId = project.id, projectName = project.name))
                },
                onSwitchServer = onSwitchServer,
            )
        }
        composable<Route.Sessions> { entry ->
            val route: Route.Sessions = entry.toRoute()
            SessionListRoute(
                projectId = route.projectId,
                projectName = route.projectName,
                onOpenSession = { session ->
                    navController.navigate(Route.Terminal(session.fullName, session.name))
                },
            )
        }
        composable<Route.Terminal> { entry ->
            val route: Route.Terminal = entry.toRoute()
            TerminalRoute(sessionFullName = route.sessionFullName, sessionName = route.sessionName)
        }
    }
}
