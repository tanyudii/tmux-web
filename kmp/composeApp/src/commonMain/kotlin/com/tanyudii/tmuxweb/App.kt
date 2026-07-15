package com.tanyudii.tmuxweb

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import org.koin.compose.koinInject

/**
 * Top-level structure mirrors RootView.swift: two mutually exclusive roots
 * (Settings vs. the main nav graph), not one NavHost with a Settings node
 * popped off — see .claude/plans/velvet-noodling-treasure.md Stage 2.
 */
@Composable
fun App() {
    MaterialTheme {
        val settingsStore: ConnectionSettingsStore = koinInject()
        val connectionTester: ConnectionTester = koinInject()
        val sessionHolder: TmuxWebSessionHolder = koinInject()
        val appScope = rememberCoroutineScope()
        val settingsViewModel = remember { ConnectionSettingsViewModel(settingsStore, connectionTester, appScope) }
        val settingsState by settingsViewModel.state.collectAsState()

        LaunchedEffect(settingsState.current) {
            sessionHolder.update(settingsState.current)
        }

        when {
            !settingsState.isLoaded -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            settingsState.current == null -> SettingsRoute(viewModel = settingsViewModel)
            else -> MainNavHost(onSwitchServer = settingsViewModel::clear)
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
