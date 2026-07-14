package com.tanyudii.tmuxweb.di

import org.koin.core.context.startKoin
import org.koin.core.module.Module
import org.koin.dsl.KoinAppDeclaration
import org.koin.dsl.module

/**
 * Phase 1 foundation: Koin plumbing only. Left empty on purpose — repository
 * and ViewModel bindings land in Phase 2/3 (see
 * .claude/plans/rebuild-web-ios-kmp.plan.md) once there's real domain/data
 * code to bind. An empty module isn't a placeholder smell here; it's the
 * seam platform entry points already depend on.
 */
val commonModule: Module = module {}

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
