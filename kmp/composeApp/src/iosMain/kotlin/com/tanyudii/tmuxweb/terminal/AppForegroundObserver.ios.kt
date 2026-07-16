package com.tanyudii.tmuxweb.terminal

import platform.Foundation.NSNotificationCenter
import platform.Foundation.NSOperationQueue
import platform.UIKit.UIApplicationDidBecomeActiveNotification

// Plain UIKit/Foundation cinterop, no Swift-side registration needed -- same
// idiom as BellFeedback.ios.kt. The old pre-KMP SwiftUI app (removed in
// commit 2d3b55c) used `@Environment(\.scenePhase) { if .active { reconnect() } }`
// for this; UIApplicationDidBecomeActiveNotification is the equivalent signal
// reachable directly from Kotlin, so no Swift changes (ContentView.swift/
// iOSApp.swift) are needed here.
actual fun observeAppForeground(onForeground: () -> Unit): () -> Unit {
    val token = NSNotificationCenter.defaultCenter.addObserverForName(
        name = UIApplicationDidBecomeActiveNotification,
        `object` = null,
        queue = NSOperationQueue.mainQueue,
    ) { _ -> onForeground() }
    return { NSNotificationCenter.defaultCenter.removeObserver(token) }
}
