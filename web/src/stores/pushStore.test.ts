import { describe, expect, it, vi } from "vitest";
import { createPushStore } from "./pushStore";

const SUBSCRIPTION = { endpoint: "https://push.example.com/a", keys: { p256dh: "p", auth: "a" } };

function fakeApi(overrides: Partial<{ getPushPublicKey: () => Promise<string>; subscribePush: () => Promise<void>; unsubscribePush: () => Promise<void> }> = {}) {
  return {
    getPushPublicKey: vi.fn().mockResolvedValue("vapid-public-key"),
    subscribePush: vi.fn().mockResolvedValue(undefined),
    unsubscribePush: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function store(
  overrides: {
    api?: ReturnType<typeof fakeApi>;
    isBrowserPushSupported?: () => boolean;
    subscribeBrowserPush?: () => Promise<typeof SUBSCRIPTION | null>;
    unsubscribeBrowserPush?: () => Promise<string | null>;
    currentBrowserPushEndpoint?: () => Promise<string | null>;
  } = {},
) {
  const api = overrides.api ?? fakeApi();
  return createPushStore({
    api,
    isBrowserPushSupported: overrides.isBrowserPushSupported ?? (() => true),
    subscribeBrowserPush: overrides.subscribeBrowserPush ?? (async () => SUBSCRIPTION),
    unsubscribeBrowserPush: overrides.unsubscribeBrowserPush ?? (async () => SUBSCRIPTION.endpoint),
    currentBrowserPushEndpoint: overrides.currentBrowserPushEndpoint ?? (async () => null),
  });
}

describe("pushStore", () => {
  // MARK: initial state

  it("isSupported reflects isBrowserPushSupported() at construction", () => {
    const s = store({ isBrowserPushSupported: () => false });
    expect(s.state.isSupported).toBe(false);
  });

  it("isEnabled stays false before start() is called, even when a subscription already exists", () => {
    const s = store({ currentBrowserPushEndpoint: async () => SUBSCRIPTION.endpoint });
    expect(s.state.isEnabled).toBe(false);
  });

  // MARK: start()

  it("start() sets isEnabled true when a subscription already exists on this device", async () => {
    const s = store({ currentBrowserPushEndpoint: async () => SUBSCRIPTION.endpoint });
    await s.start();
    expect(s.state.isEnabled).toBe(true);
  });

  it("start() leaves isEnabled false when there is no existing subscription", async () => {
    const s = store({ currentBrowserPushEndpoint: async () => null });
    await s.start();
    expect(s.state.isEnabled).toBe(false);
  });

  it("start() is a no-op (never calls currentBrowserPushEndpoint) when unsupported", async () => {
    const currentBrowserPushEndpoint = vi.fn().mockResolvedValue(SUBSCRIPTION.endpoint);
    const s = store({ isBrowserPushSupported: () => false, currentBrowserPushEndpoint });
    await s.start();
    expect(currentBrowserPushEndpoint).not.toHaveBeenCalled();
    expect(s.state.isEnabled).toBe(false);
  });

  // MARK: toggle() when off -- enable

  it("toggle when off subscribes via the browser then registers with the backend", async () => {
    const api = fakeApi();
    const s = store({ api });
    s.toggle();
    await vi.waitFor(() => expect(s.state.isBusy).toBe(false));

    expect(api.getPushPublicKey).toHaveBeenCalled();
    expect(api.subscribePush).toHaveBeenCalledWith(SUBSCRIPTION);
    expect(s.state.isEnabled).toBe(true);
    expect(s.state.errorMessage).toBeNull();
  });

  it("toggle when off surfaces an error when the browser declines to subscribe", async () => {
    const s = store({ subscribeBrowserPush: async () => null });
    s.toggle();
    await vi.waitFor(() => expect(s.state.isBusy).toBe(false));

    expect(s.state.isEnabled).toBe(false);
    expect(s.state.errorMessage).toBe(
      "Push notifications weren't enabled — check your browser's notification permission.",
    );
  });

  it("toggle when off surfaces an error when the backend subscribe call fails", async () => {
    const api = fakeApi({ subscribePush: vi.fn().mockRejectedValue(new Error("network down")) });
    const s = store({ api });
    s.toggle();
    await vi.waitFor(() => expect(s.state.isBusy).toBe(false));

    expect(s.state.isEnabled).toBe(false);
    expect(s.state.errorMessage).toBe("network down");
  });

  it("toggle sets isBusy true while the enable flow is in flight", async () => {
    let resolveSubscribe: ((value: typeof SUBSCRIPTION) => void) | undefined;
    const subscribeBrowserPush = () => new Promise<typeof SUBSCRIPTION>((resolve) => (resolveSubscribe = resolve));
    const s = store({ subscribeBrowserPush });

    s.toggle();
    expect(s.state.isBusy).toBe(true);

    // subscribeBrowserPush isn't called until the preceding
    // `await api.getPushPublicKey()` resolves -- wait for that microtask to
    // actually happen before resolving it, or resolveSubscribe is still
    // undefined and this would silently no-op.
    await vi.waitFor(() => expect(resolveSubscribe).toBeDefined());
    resolveSubscribe?.(SUBSCRIPTION);
    await vi.waitFor(() => expect(s.state.isBusy).toBe(false));
  });

  it("toggle is a no-op while already busy", async () => {
    const api = fakeApi();
    let resolveSubscribe: ((value: typeof SUBSCRIPTION) => void) | undefined;
    const subscribeBrowserPush = () => new Promise<typeof SUBSCRIPTION>((resolve) => (resolveSubscribe = resolve));
    const s = store({ api, subscribeBrowserPush });

    s.toggle();
    s.toggle(); // second click while busy must not start a second enable flow
    await vi.waitFor(() => expect(resolveSubscribe).toBeDefined());
    resolveSubscribe?.(SUBSCRIPTION);
    await vi.waitFor(() => expect(s.state.isBusy).toBe(false));

    expect(api.getPushPublicKey).toHaveBeenCalledTimes(1);
  });

  // MARK: toggle() when on -- disable

  it("toggle when on unsubscribes via the browser then unregisters with the backend", async () => {
    const api = fakeApi();
    const s = store({ api, currentBrowserPushEndpoint: async () => SUBSCRIPTION.endpoint });
    await s.start();

    s.toggle();
    await vi.waitFor(() => expect(s.state.isBusy).toBe(false));

    expect(api.unsubscribePush).toHaveBeenCalledWith(SUBSCRIPTION.endpoint);
    expect(s.state.isEnabled).toBe(false);
  });

  it("toggle when on does not call backend unsubscribe when the browser had nothing to unsubscribe", async () => {
    const api = fakeApi();
    const s = store({
      api,
      currentBrowserPushEndpoint: async () => SUBSCRIPTION.endpoint,
      unsubscribeBrowserPush: async () => null,
    });
    await s.start();

    s.toggle();
    await vi.waitFor(() => expect(s.state.isBusy).toBe(false));

    expect(api.unsubscribePush).not.toHaveBeenCalled();
    expect(s.state.isEnabled).toBe(false);
  });

  it("toggle when on surfaces an error when the backend unsubscribe call fails, but still drops isEnabled -- the browser itself already unsubscribed", async () => {
    const api = fakeApi({ unsubscribePush: vi.fn().mockRejectedValue(new Error("server unreachable")) });
    const s = store({ api, currentBrowserPushEndpoint: async () => SUBSCRIPTION.endpoint });
    await s.start();

    s.toggle();
    await vi.waitFor(() => expect(s.state.isBusy).toBe(false));

    expect(s.state.errorMessage).toBe("server unreachable");
    expect(s.state.isEnabled).toBe(false);
  });

  // MARK: dismissError()

  it("dismissError clears errorMessage without touching other state", async () => {
    const s = store({ subscribeBrowserPush: async () => null });
    s.toggle();
    await vi.waitFor(() => expect(s.state.errorMessage).not.toBeNull());

    s.dismissError();

    expect(s.state.errorMessage).toBeNull();
  });
});
