// Ports domain/BrowserPush.kt + BrowserPush.wasmJs.kt -- browser-native Web
// Push plumbing (service worker registration, Notification permission,
// PushManager subscribe/unsubscribe). Every function swallows its own
// failures and resolves null rather than throwing: the caller
// (stores/pushStore.ts) treats null as "stayed off" and shows one generic
// error message, since the many different failure reasons here (permission
// denied, no browser support, subscribe rejected, no service worker
// registered yet) don't need distinct UI treatment -- same rationale as the
// Kotlin original's kdoc.
//
// Unlike BrowserPush.kt, there is no separate expect/actual split here --
// this app only ever runs in a browser (no iOS/JVM target to stub out), so
// isBrowserPushSupported() doing real feature detection is the only
// "actual" that would ever exist.
import type { PushSubscriptionPayload } from "../api/types";

export type { PushSubscriptionPayload };

const SERVICE_WORKER_PATH = "/sw.js";

export function isBrowserPushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window
  );
}

// PushManager.subscribe's applicationServerKey wants raw bytes, but the
// server hands out the VAPID public key as URL-safe base64 (see
// push-notifications.ts's webpush.generateVAPIDKeys()) -- same by-hand
// decode BrowserPush.wasmJs.kt's subscribeToPushJs does in its JS interop.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64Safe);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

function toPayload(subscription: PushSubscription): PushSubscriptionPayload | null {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

// Must be called from a real user gesture (the toggle's onClick) --
// Notification.requestPermission() only prompts synchronously within one,
// same constraint the Kotlin original's kdoc notes.
export async function subscribeBrowserPush(vapidPublicKey: string): Promise<PushSubscriptionPayload | null> {
  try {
    if (!isBrowserPushSupported()) return null;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
    await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      }));
    return toPayload(subscription);
  } catch {
    return null;
  }
}

/** Returns the endpoint that was unsubscribed, or null if there was nothing to unsubscribe. */
export async function unsubscribeBrowserPush(): Promise<string | null> {
  try {
    if (!("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
    if (!registration) return null;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return null;
    const endpoint = subscription.endpoint;
    const ok = await subscription.unsubscribe();
    return ok ? endpoint : null;
  } catch {
    return null;
  }
}

export async function currentBrowserPushEndpoint(): Promise<string | null> {
  try {
    if (!("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
    if (!registration) return null;
    const subscription = await registration.pushManager.getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
}
