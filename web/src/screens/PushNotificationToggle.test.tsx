import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { createPushStore } from "../stores/pushStore";
import { PushNotificationToggle } from "./PushNotificationToggle";

function fakeApi() {
  return {
    getPushPublicKey: vi.fn().mockResolvedValue("vapid-key"),
    subscribePush: vi.fn().mockResolvedValue(undefined),
    unsubscribePush: vi.fn().mockResolvedValue(undefined),
  };
}

describe("PushNotificationToggle", () => {
  it("renders nothing when the platform doesn't support push", () => {
    const store = createPushStore({ api: fakeApi(), isBrowserPushSupported: () => false });
    const { container } = render(() => <PushNotificationToggle store={store} />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows the disabled bell (Enable push notifications) when supported but not subscribed", async () => {
    const store = createPushStore({
      api: fakeApi(),
      isBrowserPushSupported: () => true,
      currentBrowserPushEndpoint: async () => null,
    });
    await store.start();
    render(() => <PushNotificationToggle store={store} />);

    const button = await screen.findByRole("button", { name: "Enable push notifications" });
    expect(button).toBeTruthy();
  });

  it("shows the enabled bell (Disable push notifications) when already subscribed", async () => {
    const store = createPushStore({
      api: fakeApi(),
      isBrowserPushSupported: () => true,
      currentBrowserPushEndpoint: async () => "https://push.example.com/a",
    });
    await store.start();
    render(() => <PushNotificationToggle store={store} />);

    const button = await screen.findByRole("button", { name: "Disable push notifications" });
    expect(button).toBeTruthy();
  });

  it("clicking the toggle when off calls through to subscribe and flips to enabled", async () => {
    const api = fakeApi();
    const store = createPushStore({
      api,
      isBrowserPushSupported: () => true,
      currentBrowserPushEndpoint: async () => null,
      subscribeBrowserPush: async () => ({ endpoint: "https://push.example.com/a", keys: { p256dh: "p", auth: "a" } }),
    });
    await store.start();
    render(() => <PushNotificationToggle store={store} />);

    fireEvent.click(await screen.findByRole("button", { name: "Enable push notifications" }));

    expect(await screen.findByRole("button", { name: "Disable push notifications" })).toBeTruthy();
    expect(api.subscribePush).toHaveBeenCalled();
  });

  it("clicking the toggle when on calls through to unsubscribe and flips to disabled", async () => {
    const api = fakeApi();
    const store = createPushStore({
      api,
      isBrowserPushSupported: () => true,
      currentBrowserPushEndpoint: async () => "https://push.example.com/a",
      unsubscribeBrowserPush: async () => "https://push.example.com/a",
    });
    await store.start();
    render(() => <PushNotificationToggle store={store} />);

    fireEvent.click(await screen.findByRole("button", { name: "Disable push notifications" }));

    expect(await screen.findByRole("button", { name: "Enable push notifications" })).toBeTruthy();
    expect(api.unsubscribePush).toHaveBeenCalledWith("https://push.example.com/a");
  });
});
