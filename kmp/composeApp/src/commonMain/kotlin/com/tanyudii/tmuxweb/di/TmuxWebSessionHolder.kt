package com.tanyudii.tmuxweb.di

import com.tanyudii.tmuxweb.domain.model.ConnectionSettings
import kotlin.concurrent.Volatile

/**
 * Bridges Koin's static module graph with the one piece of app state only
 * known at runtime (after ConnectionSettingsStore.load()/
 * ConnectionSettingsViewModel.testAndSave() resolves). Koin `single`/
 * `factory` lambdas can't take a runtime-changing constructor argument, so
 * TmuxWebHttpClient/the repositories/TerminalSocket are `factory` bindings
 * that read this holder at resolution time instead of `single`s built once.
 * App() is the sole writer; every screen reachable after Settings is a
 * reader via koinInject()/get().
 */
class TmuxWebSessionHolder {
    @Volatile
    private var current: ConnectionSettings? = null

    fun update(settings: ConnectionSettings?) {
        current = settings
    }

    fun require(): ConnectionSettings =
        checkNotNull(current) {
            "TmuxWebSessionHolder read before ConnectionSettings were set — " +
                "this dependency must only be resolved from a screen reachable " +
                "after Settings succeeds (see App.kt)."
        }
}
