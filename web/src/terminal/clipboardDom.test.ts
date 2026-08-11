import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard, hideCopyToast, showCopyToast } from "./clipboardDom";

describe("copyTextToClipboard", () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
    document.execCommand = originalExecCommand;
  });

  it("uses navigator.clipboard.writeText when available and succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const result = await copyTextToClipboard("hello");

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when navigator.clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(true);

    const result = await copyTextToClipboard("hello");

    expect(result).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("falls back to execCommand when navigator.clipboard is unavailable (insecure origin)", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);

    const result = await copyTextToClipboard("hello");

    expect(result).toBe(false);
  });

  it("returns false when execCommand throws", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockImplementation(() => {
      throw new Error("blocked");
    });

    const result = await copyTextToClipboard("hello");

    expect(result).toBe(false);
  });

  it("removes the scratch textarea it creates for the fallback path", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(true);

    await copyTextToClipboard("hello");

    expect(document.querySelectorAll("textarea").length).toBe(0);
  });
});

describe("showCopyToast / hideCopyToast", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    container.remove();
  });

  it("creates a toast element with the message and success border", () => {
    showCopyToast(container, "Copied", true, 1000);

    const toast = container.querySelector(".tmux-copy-toast") as HTMLElement;
    expect(toast).not.toBeNull();
    expect(toast.textContent).toBe("Copied");
    expect(toast.style.display).toBe("block");
    // jsdom's CSSOM normalizes #3ECF8E to its rgb() equivalent.
    expect(toast.style.border).toContain("rgb(62, 207, 142)");
  });

  it("reuses the same toast element on a second call instead of creating a duplicate", () => {
    showCopyToast(container, "Copied", true, 1000);
    showCopyToast(container, "Copied again", true, 1000);

    expect(container.querySelectorAll(".tmux-copy-toast").length).toBe(1);
    expect(container.querySelector(".tmux-copy-toast")?.textContent).toBe("Copied again");
  });

  it("auto-hides after durationMs when durationMs > 0", () => {
    showCopyToast(container, "Copied", true, 1000);
    const toast = container.querySelector(".tmux-copy-toast") as HTMLElement;

    vi.advanceTimersByTime(1000);

    expect(toast.style.display).toBe("none");
  });

  it("stays visible indefinitely when durationMs <= 0", () => {
    showCopyToast(container, "Auto-copy failed", false, 0);
    const toast = container.querySelector(".tmux-copy-toast") as HTMLElement;

    vi.advanceTimersByTime(10_000);

    expect(toast.style.display).toBe("block");
  });

  it("clears a pending auto-hide timer when shown again before it fires", () => {
    showCopyToast(container, "First", true, 1000);
    vi.advanceTimersByTime(500);
    showCopyToast(container, "Second", true, 1000);
    vi.advanceTimersByTime(500);

    const toast = container.querySelector(".tmux-copy-toast") as HTMLElement;
    // The first timer (which would have fired at the 1000ms mark) must not
    // hide the toast that "Second" just re-armed for another 1000ms.
    expect(toast.style.display).toBe("block");
  });

  it("hideCopyToast hides the toast and clears any pending auto-dismiss timer", () => {
    showCopyToast(container, "Auto-copy failed", false, 0);

    hideCopyToast(container);

    const toast = container.querySelector(".tmux-copy-toast") as HTMLElement;
    expect(toast.style.display).toBe("none");
  });

  it("hideCopyToast is a no-op when no toast exists yet", () => {
    expect(() => hideCopyToast(container)).not.toThrow();
  });
});
