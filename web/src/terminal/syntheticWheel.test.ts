import { describe, expect, it, vi } from "vitest";
import { dispatchWheelNotches } from "./syntheticWheel";

function xtermContainer(): { container: HTMLDivElement; screen: HTMLDivElement } {
  const container = document.createElement("div");
  const xterm = document.createElement("div");
  xterm.className = "xterm";
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  xterm.appendChild(screen);
  container.appendChild(xterm);
  return { container, screen };
}

describe("dispatchWheelNotches", () => {
  it("dispatches one wheel event per notch", () => {
    const { container, screen } = xtermContainer();
    const seen = vi.fn();
    screen.addEventListener("wheel", seen);

    const sent = dispatchWheelNotches(container, 3, -18, { clientX: 40, clientY: 90 });

    expect(sent).toBe(3);
    expect(seen).toHaveBeenCalledTimes(3);
  });

  it("carries the direction, position and pixel delta mode", () => {
    const { container, screen } = xtermContainer();
    let event: WheelEvent | null = null;
    screen.addEventListener("wheel", (e) => (event = e as WheelEvent));

    dispatchWheelNotches(container, 1, -18, { clientX: 40, clientY: 90 });

    expect(event!.deltaY).toBe(-18);
    expect(event!.clientX).toBe(40);
    expect(event!.clientY).toBe(90);
    expect(event!.deltaMode).toBe(0);
  });

  // xterm.js attaches its mouse listeners to .xterm / .xterm-viewport, which
  // are DESCENDANTS of our container -- an event dispatched on the container
  // would bubble away from them and never arrive.
  it("dispatches deep enough for the event to bubble up to xterm's own listeners", () => {
    const { container, screen } = xtermContainer();
    const onXterm = vi.fn();
    container.querySelector(".xterm")!.addEventListener("wheel", onXterm);
    const onScreen = vi.fn();
    screen.addEventListener("wheel", onScreen);

    dispatchWheelNotches(container, 1, 18, { clientX: 1, clientY: 2 });

    expect(onScreen).toHaveBeenCalledOnce();
    expect(onXterm).toHaveBeenCalledOnce();
  });

  it("reports 0 when xterm has not rendered yet, so the caller can fall back", () => {
    const container = document.createElement("div");

    expect(dispatchWheelNotches(container, 2, -18, { clientX: 0, clientY: 0 })).toBe(0);
  });

  it("falls back to the .xterm element when no screen element exists", () => {
    const container = document.createElement("div");
    const xterm = document.createElement("div");
    xterm.className = "xterm";
    container.appendChild(xterm);
    const seen = vi.fn();
    xterm.addEventListener("wheel", seen);

    expect(dispatchWheelNotches(container, 1, 18, { clientX: 0, clientY: 0 })).toBe(1);
    expect(seen).toHaveBeenCalledOnce();
  });

  it("dispatches nothing for a zero notch count or zero delta", () => {
    const { container, screen } = xtermContainer();
    const seen = vi.fn();
    screen.addEventListener("wheel", seen);

    expect(dispatchWheelNotches(container, 0, -18, { clientX: 0, clientY: 0 })).toBe(0);
    expect(dispatchWheelNotches(container, 2, 0, { clientX: 0, clientY: 0 })).toBe(0);
    expect(seen).not.toHaveBeenCalled();
  });
});
