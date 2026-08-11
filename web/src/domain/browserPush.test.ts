import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentBrowserPushEndpoint,
  isBrowserPushSupported,
  subscribeBrowserPush,
  unsubscribeBrowserPush,
} from "./browserPush";

const VAPID_KEY = "BEl62iUYgUivxIkv69yViEuiBIa40HI0DLLuxazjhq0Y8y_l7-Vp7ykZjMDIQ8f4Kw0XV_hZpNe0EX9bV1KFn30";

function defineNavigatorProperty(name: string, value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true });
}

function defineWindowProperty(name: string, value: unknown): void {
  Object.defineProperty(window, name, { value, configurable: true });
}

// A real unsupported browser never has these keys at all -- setting a
// property to `undefined` still leaves the key present, which the `in`
// operator (what isBrowserPushSupported actually uses, matching
// BrowserPush.wasmJs.kt's own `'serviceWorker' in navigator` check) treats
// as "exists". Only `delete` reproduces "genuinely absent".
function deleteNavigatorProperty(name: string): void {
  delete (navigator as unknown as Record<string, unknown>)[name];
}

function deleteWindowProperty(name: string): void {
  delete (window as unknown as Record<string, unknown>)[name];
}

function fakeSubscription(endpoint: string, unsubscribeResult = true) {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p256dh-value", auth: "auth-value" } }),
    unsubscribe: vi.fn().mockResolvedValue(unsubscribeResult),
  };
}

describe("browserPush", () => {
  const originalServiceWorker = (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  const originalPushManager = (window as unknown as { PushManager?: unknown }).PushManager;
  const originalNotification = (window as unknown as { Notification?: unknown }).Notification;

  // Restores each global to its exact pre-test shape -- `delete` (not
  // "define as undefined") when it was genuinely absent to start with, or
  // the property key would leak into later tests as "present but
  // undefined" and silently change what `in` reports for them too.
  afterEach(() => {
    if (originalServiceWorker === undefined) deleteNavigatorProperty("serviceWorker");
    else defineNavigatorProperty("serviceWorker", originalServiceWorker);
    if (originalPushManager === undefined) deleteWindowProperty("PushManager");
    else defineWindowProperty("PushManager", originalPushManager);
    if (originalNotification === undefined) deleteWindowProperty("Notification");
    else defineWindowProperty("Notification", originalNotification);
    vi.unstubAllGlobals();
  });

  // MARK: isBrowserPushSupported

  describe("isBrowserPushSupported", () => {
    it("returns true when both serviceWorker and PushManager exist", () => {
      defineNavigatorProperty("serviceWorker", {});
      defineWindowProperty("PushManager", class {});

      expect(isBrowserPushSupported()).toBe(true);
    });

    it("returns false when serviceWorker is missing", () => {
      deleteNavigatorProperty("serviceWorker");
      defineWindowProperty("PushManager", class {});

      expect(isBrowserPushSupported()).toBe(false);
    });

    it("returns false when PushManager is missing", () => {
      defineNavigatorProperty("serviceWorker", {});
      deleteWindowProperty("PushManager");

      expect(isBrowserPushSupported()).toBe(false);
    });
  });

  // MARK: subscribeBrowserPush

  describe("subscribeBrowserPush", () => {
    it("returns null when the platform doesn't support push at all", async () => {
      deleteNavigatorProperty("serviceWorker");
      deleteWindowProperty("PushManager");
      const register = vi.fn();
      defineNavigatorProperty("serviceWorker", { register });

      const result = await subscribeBrowserPush(VAPID_KEY);

      expect(result).toBeNull();
      // The unsupported check must short-circuit before ever touching the
      // service worker registry -- proves this isn't passing by accident
      // via some other later failure.
      expect(register).not.toHaveBeenCalled();
    });

    it("returns null when the user declines the permission prompt", async () => {
      defineWindowProperty("PushManager", class {});
      const requestPermission = vi.fn().mockResolvedValue("denied");
      defineWindowProperty("Notification", { requestPermission });
      vi.stubGlobal("Notification", { requestPermission });
      defineNavigatorProperty("serviceWorker", { register: vi.fn() });

      const result = await subscribeBrowserPush(VAPID_KEY);

      expect(result).toBeNull();
      expect(requestPermission).toHaveBeenCalled();
    });

    it("registers the service worker and subscribes when granted with no existing subscription", async () => {
      defineWindowProperty("PushManager", class {});
      vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("granted") });
      const subscription = fakeSubscription("https://push.example.com/new");
      const pushManager = {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockResolvedValue(subscription),
      };
      const registration = { pushManager };
      const register = vi.fn().mockResolvedValue(registration);
      defineNavigatorProperty("serviceWorker", { register, ready: Promise.resolve(registration) });

      const result = await subscribeBrowserPush(VAPID_KEY);

      expect(register).toHaveBeenCalledWith("/sw.js");
      expect(pushManager.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }),
      );
      expect(result).toEqual({
        endpoint: "https://push.example.com/new",
        keys: { p256dh: "p256dh-value", auth: "auth-value" },
      });
    });

    it("reuses an existing subscription instead of subscribing again", async () => {
      defineWindowProperty("PushManager", class {});
      vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("granted") });
      const subscription = fakeSubscription("https://push.example.com/existing");
      const pushManager = { getSubscription: vi.fn().mockResolvedValue(subscription), subscribe: vi.fn() };
      const registration = { pushManager };
      defineNavigatorProperty("serviceWorker", {
        register: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      });

      const result = await subscribeBrowserPush(VAPID_KEY);

      expect(pushManager.subscribe).not.toHaveBeenCalled();
      expect(result?.endpoint).toBe("https://push.example.com/existing");
    });

    it("returns null when registration throws", async () => {
      defineWindowProperty("PushManager", class {});
      vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("granted") });
      defineNavigatorProperty("serviceWorker", { register: vi.fn().mockRejectedValue(new Error("no sw")) });

      const result = await subscribeBrowserPush(VAPID_KEY);

      expect(result).toBeNull();
    });
  });

  // MARK: unsubscribeBrowserPush

  describe("unsubscribeBrowserPush", () => {
    it("returns null when there is no service worker at all", async () => {
      deleteNavigatorProperty("serviceWorker");

      expect(await unsubscribeBrowserPush()).toBeNull();
    });

    it("returns null when there is no registration for /sw.js", async () => {
      defineNavigatorProperty("serviceWorker", { getRegistration: vi.fn().mockResolvedValue(undefined) });

      expect(await unsubscribeBrowserPush()).toBeNull();
    });

    it("returns null when the registration has no active subscription", async () => {
      const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } };
      defineNavigatorProperty("serviceWorker", { getRegistration: vi.fn().mockResolvedValue(registration) });

      expect(await unsubscribeBrowserPush()).toBeNull();
    });

    it("returns the endpoint when unsubscribe succeeds", async () => {
      const subscription = fakeSubscription("https://push.example.com/gone", true);
      const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } };
      defineNavigatorProperty("serviceWorker", { getRegistration: vi.fn().mockResolvedValue(registration) });

      expect(await unsubscribeBrowserPush()).toBe("https://push.example.com/gone");
      expect(subscription.unsubscribe).toHaveBeenCalled();
    });

    it("returns null when the browser reports unsubscribe failed", async () => {
      const subscription = fakeSubscription("https://push.example.com/gone", false);
      const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } };
      defineNavigatorProperty("serviceWorker", { getRegistration: vi.fn().mockResolvedValue(registration) });

      expect(await unsubscribeBrowserPush()).toBeNull();
    });
  });

  // MARK: currentBrowserPushEndpoint

  describe("currentBrowserPushEndpoint", () => {
    it("returns null when there is no service worker registration yet", async () => {
      defineNavigatorProperty("serviceWorker", { getRegistration: vi.fn().mockResolvedValue(undefined) });

      expect(await currentBrowserPushEndpoint()).toBeNull();
    });

    it("returns null when registered but not subscribed", async () => {
      const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } };
      defineNavigatorProperty("serviceWorker", { getRegistration: vi.fn().mockResolvedValue(registration) });

      expect(await currentBrowserPushEndpoint()).toBeNull();
    });

    it("returns the endpoint of an existing subscription", async () => {
      const subscription = fakeSubscription("https://push.example.com/current");
      const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } };
      defineNavigatorProperty("serviceWorker", { getRegistration: vi.fn().mockResolvedValue(registration) });

      expect(await currentBrowserPushEndpoint()).toBe("https://push.example.com/current");
    });

    it("returns null when reading the registration throws", async () => {
      defineNavigatorProperty("serviceWorker", { getRegistration: vi.fn().mockRejectedValue(new Error("boom")) });

      expect(await currentBrowserPushEndpoint()).toBeNull();
    });
  });
});
