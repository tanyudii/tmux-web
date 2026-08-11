// Ports presentation/PushNotificationViewModel.kt -- drives the "Enable
// push notifications" bell toggle. domain/browserPush.ts owns the actual
// browser interaction (service worker, Notification permission,
// PushManager); this store just sequences it with the backend's
// subscribe/unsubscribe calls (api/client.ts's getPushPublicKey/
// subscribePush/unsubscribePush) and reflects the outcome as UI state.
//
// Deliberately not session-scoped: unlike environmentStore.ts/logsStore.ts,
// a push subscription is a property of the browser/service-worker
// registration, not of any particular project or session (the backend
// repository takes no project/session id either -- see
// PushNotificationRepository.kt's kdoc). Callers should create exactly one
// instance for the lifetime of the connected app, not one per session pane
// -- see App.tsx for where this is actually constructed.
import { createStore } from "solid-js/store";
import type { ApiClient } from "../api/client";
import {
  currentBrowserPushEndpoint as realCurrentBrowserPushEndpoint,
  isBrowserPushSupported as realIsBrowserPushSupported,
  subscribeBrowserPush as realSubscribeBrowserPush,
  unsubscribeBrowserPush as realUnsubscribeBrowserPush,
  type PushSubscriptionPayload,
} from "../domain/browserPush";
import { toUiMessage } from "./errorMessage";

export interface PushState {
  isSupported: boolean;
  isEnabled: boolean;
  isBusy: boolean;
  errorMessage: string | null;
}

export interface PushStoreDeps {
  api: Pick<ApiClient, "getPushPublicKey" | "subscribePush" | "unsubscribePush">;
  isBrowserPushSupported?: () => boolean;
  subscribeBrowserPush?: (vapidPublicKey: string) => Promise<PushSubscriptionPayload | null>;
  unsubscribeBrowserPush?: () => Promise<string | null>;
  currentBrowserPushEndpoint?: () => Promise<string | null>;
}

const NOT_ENABLED_MESSAGE = "Push notifications weren't enabled — check your browser's notification permission.";

export function createPushStore(deps: PushStoreDeps) {
  const { api } = deps;
  const isBrowserPushSupported = deps.isBrowserPushSupported ?? realIsBrowserPushSupported;
  const subscribeBrowserPush = deps.subscribeBrowserPush ?? realSubscribeBrowserPush;
  const unsubscribeBrowserPush = deps.unsubscribeBrowserPush ?? realUnsubscribeBrowserPush;
  const currentBrowserPushEndpoint = deps.currentBrowserPushEndpoint ?? realCurrentBrowserPushEndpoint;

  const [state, setState] = createStore<PushState>({
    isSupported: isBrowserPushSupported(),
    isEnabled: false,
    isBusy: false,
    errorMessage: null,
  });

  /** Checks whether this device already has an active subscription -- call once when the app connects. */
  async function start(): Promise<void> {
    if (!state.isSupported) return;
    const endpoint = await currentBrowserPushEndpoint();
    setState({ isEnabled: endpoint !== null });
  }

  async function enable(): Promise<void> {
    setState({ isBusy: true, errorMessage: null });
    try {
      const publicKey = await api.getPushPublicKey();
      const subscription = await subscribeBrowserPush(publicKey);
      if (!subscription) throw new Error(NOT_ENABLED_MESSAGE);
      await api.subscribePush(subscription);
      setState({ isBusy: false, isEnabled: true });
    } catch (error) {
      setState({ isBusy: false, errorMessage: toUiMessage(error) });
    }
  }

  async function disable(): Promise<void> {
    setState({ isBusy: true, errorMessage: null });
    try {
      const endpoint = await unsubscribeBrowserPush();
      // The browser has already dropped its own subscription at this
      // point -- this device can no longer receive pushes regardless of
      // whether the backend call below succeeds, so isEnabled must reflect
      // that now, not only once the whole flow finishes without error. A
      // toggle that still reads "on" after the browser itself unsubscribed
      // is a worse failure mode than an unreachable backend leaving a
      // stale subscription record for a few seconds (code review finding
      // during 18f: this diverges from the Kotlin original, which has the
      // same gap).
      setState({ isBusy: false, isEnabled: false });
      if (endpoint !== null) await api.unsubscribePush(endpoint);
    } catch (error) {
      setState({ errorMessage: toUiMessage(error) });
    }
  }

  function toggle(): void {
    if (state.isBusy) return;
    void (state.isEnabled ? disable() : enable());
  }

  function dismissError(): void {
    setState({ errorMessage: null });
  }

  return { state, start, toggle, dismissError };
}

export type PushStore = ReturnType<typeof createPushStore>;
