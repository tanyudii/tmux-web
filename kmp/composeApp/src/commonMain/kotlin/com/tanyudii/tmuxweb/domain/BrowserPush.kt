package com.tanyudii.tmuxweb.domain

import com.tanyudii.tmuxweb.domain.model.PushSubscriptionPayload

/**
 * Browser-native Web Push plumbing (service worker registration,
 * Notification permission, PushManager subscribe/unsubscribe) -- see
 * BrowserPush.wasmJs.kt for the real implementation. iOS/JVM have no
 * browser to register a service worker against, so their actuals are
 * harmless no-ops (same "expect/actual with a Web-meaningful default"
 * pattern as PageVisibility.kt/DefaultServerUrl.kt) rather than this
 * feature living in a wasmJs-only file -- PushNotificationViewModel
 * (commonMain, only ever instantiated from Web-specific UI) can stay
 * platform-agnostic like every other ViewModel in this codebase.
 */
expect suspend fun subscribeBrowserPush(vapidPublicKey: String): PushSubscriptionPayload?

/** Returns the endpoint that was unsubscribed, or null if there was nothing to unsubscribe. */
expect suspend fun unsubscribeBrowserPush(): String?

expect suspend fun currentBrowserPushEndpoint(): String?

/** Whether this platform can register a service worker + subscribe to push at all. */
expect fun isBrowserPushSupported(): Boolean
