package com.tanyudii.tmuxweb.di

import com.tanyudii.tmuxweb.data.local.BaseUrlStore
import com.tanyudii.tmuxweb.data.local.TokenStore
import com.tanyudii.tmuxweb.data.remote.ConnectionTester
import com.tanyudii.tmuxweb.data.remote.KtorConnectionTester
import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.data.remote.createTmuxWebHttpClient
import com.tanyudii.tmuxweb.data.remote.logs.KtorLogsSocket
import com.tanyudii.tmuxweb.data.remote.logs.LogsSocket
import com.tanyudii.tmuxweb.data.remote.terminal.KtorTerminalSocket
import com.tanyudii.tmuxweb.data.remote.terminal.TerminalSocket
import com.tanyudii.tmuxweb.domain.repository.BrowseRepository
import com.tanyudii.tmuxweb.domain.repository.ChangesRepository
import com.tanyudii.tmuxweb.domain.repository.ConnectionSettingsStore
import com.tanyudii.tmuxweb.domain.repository.DefaultConnectionSettingsStore
import com.tanyudii.tmuxweb.domain.repository.EnvironmentRepository
import com.tanyudii.tmuxweb.domain.repository.KtorBrowseRepository
import com.tanyudii.tmuxweb.domain.repository.KtorChangesRepository
import com.tanyudii.tmuxweb.domain.repository.KtorEnvironmentRepository
import com.tanyudii.tmuxweb.domain.repository.KtorProjectsRepository
import com.tanyudii.tmuxweb.domain.repository.KtorPushNotificationRepository
import com.tanyudii.tmuxweb.domain.repository.KtorSessionTemplatesRepository
import com.tanyudii.tmuxweb.domain.repository.KtorSessionsRepository
import com.tanyudii.tmuxweb.domain.repository.ProjectsRepository
import com.tanyudii.tmuxweb.domain.repository.PushNotificationRepository
import com.tanyudii.tmuxweb.domain.repository.SessionTemplatesRepository
import com.tanyudii.tmuxweb.domain.repository.SessionsRepository
import io.ktor.client.HttpClient
import org.koin.core.context.startKoin
import org.koin.core.module.Module
import org.koin.dsl.KoinAppDeclaration
import org.koin.dsl.module

/**
 * Local storage, network, and repository bindings — see
 * [TmuxWebSessionHolder] for why [TmuxWebHttpClient]/[TerminalSocket]/the
 * repositories are `factory`, not `single`: they need a `baseUrl`/`token`
 * only known once Settings succeeds, and must be rebuilt whenever that
 * changes (testAndSave()/clear()), never cached stale.
 */
val commonModule: Module = module {
    single { TokenStore() }
    single { BaseUrlStore() }
    single<ConnectionSettingsStore> { DefaultConnectionSettingsStore(get(), get()) }

    single<HttpClient> { createTmuxWebHttpClient() }
    single<ConnectionTester> { KtorConnectionTester(get()) }
    single { TmuxWebSessionHolder() }

    factory {
        val settings = get<TmuxWebSessionHolder>().require()
        TmuxWebHttpClient(httpClient = get(), baseUrl = settings.baseUrl, token = settings.token)
    }

    factory<ProjectsRepository> { KtorProjectsRepository(get()) }
    factory<SessionsRepository> { KtorSessionsRepository(get()) }
    factory<SessionTemplatesRepository> { KtorSessionTemplatesRepository(get()) }
    factory<ChangesRepository> { KtorChangesRepository(get()) }
    factory<EnvironmentRepository> { KtorEnvironmentRepository(get()) }
    factory<BrowseRepository> { KtorBrowseRepository(get()) }
    factory<PushNotificationRepository> { KtorPushNotificationRepository(get()) }

    factory<TerminalSocket> {
        val settings = get<TmuxWebSessionHolder>().require()
        KtorTerminalSocket(httpClient = get(), baseUrl = settings.baseUrl, token = settings.token)
    }

    factory<LogsSocket> {
        val settings = get<TmuxWebSessionHolder>().require()
        KtorLogsSocket(httpClient = get(), baseUrl = settings.baseUrl, token = settings.token)
    }
}

/**
 * Called once per platform entry point (wasmJsMain's main.kt, iosMain's
 * MainViewController.kt) before any Composable that resolves a Koin
 * dependency runs. [platformModule] carries platform-specific bindings
 * (e.g. the iOS Keychain-backed TokenStore vs the Web localStorage one,
 * once Phase 2 adds them).
 */
fun initKoin(platformModule: Module = module {}, appDeclaration: KoinAppDeclaration = {}) {
    startKoin {
        appDeclaration()
        modules(commonModule, platformModule)
    }
}
