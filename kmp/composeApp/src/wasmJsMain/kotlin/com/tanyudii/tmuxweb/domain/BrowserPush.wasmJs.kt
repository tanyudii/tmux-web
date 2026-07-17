@file:OptIn(ExperimentalWasmJsInterop::class)

package com.tanyudii.tmuxweb.domain

import com.tanyudii.tmuxweb.domain.model.PushSubscriptionKeys
import com.tanyudii.tmuxweb.domain.model.PushSubscriptionPayload
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.js.ExperimentalWasmJsInterop

actual fun isBrowserPushSupported(): Boolean = js("('serviceWorker' in navigator) && ('PushManager' in window)")

// Registers /sw.js (see wasmJsMain/resources/sw.js), requests Notification
// permission (must be called from a real user gesture -- the toggle's
// onClick -- since this runs synchronously in the same JS task, that
// gesture survives the Kotlin/Wasm call boundary), then subscribes via
// PushManager. Returns null on any failure/denial rather than throwing --
// the caller (PushNotificationViewModel) treats null as "stayed off" and
// shows a generic error, since the many different failure reasons here
// (permission denied, no service-worker support, subscribe rejected) don't
// need distinct UI treatment.
actual suspend fun subscribeBrowserPush(vapidPublicKey: String): PushSubscriptionPayload? =
    suspendCancellableCoroutine { cont ->
        subscribeToPushJs(vapidPublicKey) { endpoint, p256dh, auth ->
            val result = if (endpoint != null && p256dh != null && auth != null) {
                PushSubscriptionPayload(endpoint.toString(), PushSubscriptionKeys(p256dh.toString(), auth.toString()))
            } else {
                null
            }
            cont.resumeWith(Result.success(result))
        }
    }

actual suspend fun unsubscribeBrowserPush(): String? =
    suspendCancellableCoroutine { cont ->
        unsubscribeFromPushJs { endpoint -> cont.resumeWith(Result.success(endpoint?.toString())) }
    }

actual suspend fun currentBrowserPushEndpoint(): String? =
    suspendCancellableCoroutine { cont ->
        currentPushEndpointJs { endpoint -> cont.resumeWith(Result.success(endpoint?.toString())) }
    }

@Suppress("UnusedParameter")
private fun subscribeToPushJs(
    vapidPublicKey: String,
    onResult: (endpoint: JsString?, p256dh: JsString?, auth: JsString?) -> Unit,
): Unit = js(
    """{
        (async function () {
            try {
                if (!('serviceWorker' in navigator) || !('PushManager' in window)) { onResult(null, null, null); return; }
                var permission = await Notification.requestPermission();
                if (permission !== 'granted') { onResult(null, null, null); return; }
                var registration = await navigator.serviceWorker.register('/sw.js');
                await navigator.serviceWorker.ready;
                var existing = await registration.pushManager.getSubscription();
                var subscription = existing;
                if (!subscription) {
                    var padding = '='.repeat((4 - vapidPublicKey.length % 4) % 4);
                    var base64 = (vapidPublicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
                    var rawData = window.atob(base64);
                    var keyBytes = new Uint8Array(rawData.length);
                    for (var i = 0; i < rawData.length; ++i) keyBytes[i] = rawData.charCodeAt(i);
                    subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: keyBytes,
                    });
                }
                var json = subscription.toJSON();
                onResult(json.endpoint, json.keys.p256dh, json.keys.auth);
            } catch (e) {
                onResult(null, null, null);
            }
        })();
    }""",
)

@Suppress("UnusedParameter")
private fun unsubscribeFromPushJs(onResult: (endpoint: JsString?) -> Unit): Unit = js(
    """{
        (async function () {
            try {
                if (!('serviceWorker' in navigator)) { onResult(null); return; }
                var registration = await navigator.serviceWorker.getRegistration('/sw.js');
                if (!registration) { onResult(null); return; }
                var subscription = await registration.pushManager.getSubscription();
                if (!subscription) { onResult(null); return; }
                var endpoint = subscription.endpoint;
                var ok = await subscription.unsubscribe();
                onResult(ok ? endpoint : null);
            } catch (e) {
                onResult(null);
            }
        })();
    }""",
)

@Suppress("UnusedParameter")
private fun currentPushEndpointJs(onResult: (endpoint: JsString?) -> Unit): Unit = js(
    """{
        (async function () {
            try {
                if (!('serviceWorker' in navigator)) { onResult(null); return; }
                var registration = await navigator.serviceWorker.getRegistration('/sw.js');
                if (!registration) { onResult(null); return; }
                var subscription = await registration.pushManager.getSubscription();
                onResult(subscription ? subscription.endpoint : null);
            } catch (e) {
                onResult(null);
            }
        })();
    }""",
)
