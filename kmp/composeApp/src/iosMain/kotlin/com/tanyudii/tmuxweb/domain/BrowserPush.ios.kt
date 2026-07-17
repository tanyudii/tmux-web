package com.tanyudii.tmuxweb.domain

import com.tanyudii.tmuxweb.domain.model.PushSubscriptionPayload

// iOS has its own native push mechanism (APNs), not the browser Push API --
// out of scope for EMB-212, which is Web-only. See BrowserPush.kt.
@Suppress("UnusedParameter")
actual suspend fun subscribeBrowserPush(vapidPublicKey: String): PushSubscriptionPayload? = null

actual suspend fun unsubscribeBrowserPush(): String? = null

actual suspend fun currentBrowserPushEndpoint(): String? = null

actual fun isBrowserPushSupported(): Boolean = false
