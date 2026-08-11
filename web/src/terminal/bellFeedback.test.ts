import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerBellFeedback } from "./bellFeedback";

describe("triggerBellFeedback", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.title = "";
    delete (window as unknown as { _tmuxBell?: unknown })._tmuxBell;
  });

  it("does not throw when AudioContext and Notification are unavailable (best-effort)", () => {
    expect(() => triggerBellFeedback("Bell!")).not.toThrow();
  });

  it("flashes the document title until the tab regains focus", () => {
    vi.useFakeTimers();
    document.title = "tmux-web";
    vi.stubGlobal("document", document);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);

    triggerBellFeedback("Bell!");
    expect(document.title).toBe("tmux-web");

    vi.advanceTimersByTime(1000);
    expect(document.title).toBe("Bell!");

    vi.advanceTimersByTime(1000);
    expect(document.title).toBe("tmux-web");

    hasFocus.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(document.title).toBe("tmux-web");
    vi.advanceTimersByTime(2000);
    // Stopped flashing -- title stays put instead of continuing to alternate.
    expect(document.title).toBe("tmux-web");
  });

  it("re-triggering while already flashing updates the pending alert text without restarting the interval", () => {
    vi.useFakeTimers();
    document.title = "tmux-web";
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    triggerBellFeedback("First alert");
    triggerBellFeedback("Second alert");

    vi.advanceTimersByTime(1000);

    expect(document.title).toBe("Second alert");
  });

  it("shows a Notification only when permission was already granted", () => {
    const notificationCtor = vi.fn();
    class FakeNotification {
      static permission = "granted";
      constructor(title: string, options: unknown) {
        notificationCtor(title, options);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);

    triggerBellFeedback("Bell!");

    expect(notificationCtor).toHaveBeenCalledWith("Bell!", { body: "tmux-web", tag: "tmux-web-bell" });
  });

  it("does not show a Notification when permission was not granted", () => {
    const notificationCtor = vi.fn();
    class FakeNotification {
      static permission = "default";
      constructor(title: string, options: unknown) {
        notificationCtor(title, options);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);

    triggerBellFeedback("Bell!");

    expect(notificationCtor).not.toHaveBeenCalled();
  });
});
