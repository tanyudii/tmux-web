package com.tanyudii.tmuxweb.domain

import com.tanyudii.tmuxweb.domain.model.PushSubscriptionPayload

// Coverage-only target (see composeApp/build.gradle.kts) -- no real desktop
// app ships from this target, and no browser to register a service worker
// against either way.
@Suppress("UnusedParameter")
actual suspend fun subscribeBrowserPush(vapidPublicKey: String): PushSubscriptionPayload? = null

actual suspend fun unsubscribeBrowserPush(): String? = null

actual suspend fun currentBrowserPushEndpoint(): String? = null

actual fun isBrowserPushSupported(): Boolean = false
