import { describe, expect, it, vi } from "vitest";
import { attachWheelScroll, wheelDeltaToPixels } from "./wheelScroll";

function wheel(init: Partial<WheelEventInit> = {}): WheelEvent {
  return new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
}

describe("wheelDeltaToPixels", () => {
  it("passes pixel-mode deltas through unchanged", () => {
    expect(wheelDeltaToPixels(wheel({ deltaY: 120, deltaMode: 0 }), 800)).toBe(120);
  });

  it("converts line-mode deltas (Firefox) into pixels", () => {
    expect(wheelDeltaToPixels(wheel({ deltaY: 3, deltaMode: 1 }), 800)).toBe(48);
  });

  it("converts page-mode deltas using the container height", () => {
    expect(wheelDeltaToPixels(wheel({ deltaY: 1, deltaMode: 2 }), 800)).toBe(800);
  });

  it("falls back to a fixed page height when the container has not been laid out yet", () => {
    expect(wheelDeltaToPixels(wheel({ deltaY: 1, deltaMode: 2 }), 0)).toBe(400);
  });
});

describe("attachWheelScroll", () => {
  it("reports the wheel delta and cancels the event so xterm never sees it", () => {
    const container = document.createElement("div");
    const onWheel = vi.fn();
    attachWheelScroll(container, { onWheel });

    const event = wheel({ deltaY: 90 });
    container.dispatchEvent(event);

    expect(onWheel).toHaveBeenCalledWith(90);
    // preventDefault + stopPropagation are what stop xterm.js translating
    // the wheel into arrow keys while tmux holds the alternate buffer --
    // the actual bug this module exists to fix.
    expect(event.defaultPrevented).toBe(true);
  });

  it("reports a negative delta when scrolling up into history", () => {
    const container = document.createElement("div");
    const onWheel = vi.fn();
    attachWheelScroll(container, { onWheel });

    container.dispatchEvent(wheel({ deltaY: -45 }));

    expect(onWheel).toHaveBeenCalledWith(-45);
  });

  // A Mac trackpad PINCH arrives as wheel + ctrlKey. Letting it through
  // does not preserve zoom -- xterm.js cancels it itself and translates it
  // into arrow keys, which is the shell-history bug. So it must still be
  // swallowed here; it just must not become a tmux scroll.
  it("swallows Ctrl/Cmd+wheel (Mac pinch) so xterm can never turn it into arrow keys, but does not scroll", () => {
    const container = document.createElement("div");
    const onWheel = vi.fn();
    attachWheelScroll(container, { onWheel });

    const ctrlEvent = wheel({ deltaY: 90, ctrlKey: true });
    const metaEvent = wheel({ deltaY: 90, metaKey: true });
    container.dispatchEvent(ctrlEvent);
    container.dispatchEvent(metaEvent);

    expect(onWheel).not.toHaveBeenCalled();
    expect(ctrlEvent.defaultPrevented).toBe(true);
    expect(metaEvent.defaultPrevented).toBe(true);
  });

  it("ignores a zero delta without cancelling the event", () => {
    const container = document.createElement("div");
    const onWheel = vi.fn();
    attachWheelScroll(container, { onWheel });

    const event = wheel({ deltaY: 0 });
    container.dispatchEvent(event);

    expect(onWheel).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops reporting once detached", () => {
    const container = document.createElement("div");
    const onWheel = vi.fn();
    const detach = attachWheelScroll(container, { onWheel });

    detach();
    container.dispatchEvent(wheel({ deltaY: 90 }));

    expect(onWheel).not.toHaveBeenCalled();
  });

  // A full-screen app that turned mouse tracking on (Claude Code, htop,
  // mouse-enabled vim) scrolls its OWN view from wheel escapes. Hijacking
  // the wheel there sent it to tmux copy-mode instead -- and such a pane is
  // on the alternate screen with zero scrollback, so copy-mode had nothing
  // to scroll and merely froze the pane. The event must pass through
  // completely untouched so xterm.js can emit the mouse escape.
  it("leaves the wheel entirely alone while the app has mouse tracking on", () => {
    const container = document.createElement("div");
    const onWheel = vi.fn();
    attachWheelScroll(container, { onWheel, isEnabled: () => false });

    const event = wheel({ deltaY: 90 });
    container.dispatchEvent(event);

    expect(onWheel).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("still hijacks the wheel while the app has mouse tracking off", () => {
    const container = document.createElement("div");
    const onWheel = vi.fn();
    attachWheelScroll(container, { onWheel, isEnabled: () => true });

    const event = wheel({ deltaY: 90 });
    container.dispatchEvent(event);

    expect(onWheel).toHaveBeenCalledWith(90);
    expect(event.defaultPrevented).toBe(true);
  });

  // Zoom must never reach the app or the browser, mouse tracking or not --
  // otherwise the whole page zooms on a trackpad pinch.
  it("still swallows Ctrl+wheel even while the app has mouse tracking on", () => {
    const container = document.createElement("div");
    const onWheel = vi.fn();
    attachWheelScroll(container, { onWheel, isEnabled: () => false });

    const event = wheel({ deltaY: 90, ctrlKey: true });
    container.dispatchEvent(event);

    expect(onWheel).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("re-reads the mouse-tracking state on every wheel event", () => {
    const container = document.createElement("div");
    const onWheel = vi.fn();
    let enabled = false;
    attachWheelScroll(container, { onWheel, isEnabled: () => enabled });

    container.dispatchEvent(wheel({ deltaY: 90 }));
    expect(onWheel).not.toHaveBeenCalled();

    // The user quits the TUI: tracking goes off, hijacking must resume
    // without re-attaching anything.
    enabled = true;
    container.dispatchEvent(wheel({ deltaY: 90 }));
    expect(onWheel).toHaveBeenCalledWith(90);
  });
});
