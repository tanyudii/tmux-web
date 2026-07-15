package com.tanyudii.tmuxweb

import androidx.compose.ui.window.ComposeUIViewController
import com.tanyudii.tmuxweb.di.initKoin
import platform.UIKit.UIViewController

private val koinStarted = KoinStartupGuard()

private class KoinStartupGuard {
    private var started = false

    fun startOnce(start: () -> Unit) {
        if (!started) {
            started = true
            start()
        }
    }
}

@Suppress("FunctionNaming") // standard KMP/Compose-iOS entry-point naming convention
fun MainViewController(): UIViewController {
    koinStarted.startOnce { initKoin() }
    return ComposeUIViewController {
        App()
    }
}
