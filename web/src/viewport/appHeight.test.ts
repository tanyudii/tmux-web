import { describe, expect, it, vi } from "vitest";
import { attachAppHeight, APP_HEIGHT_PROPERTY } from "./appHeight";

function fakeViewport(height: number) {
  const listeners: Record<string, Array<() => void>> = { resize: [], scroll: [] };
  return {
    height,
    addEventListener: (type: string, listener: () => void) => listeners[type]?.push(listener),
    removeEventListener: (type: string, listener: () => void) => {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== listener);
    },
    emit(type: string) {
      for (const l of listeners[type] ?? []) l();
    },
    listenerCount: () => listeners.resize.length + listeners.scroll.length,
  };
}

function fakeTarget() {
  const props: Record<string, string> = {};
  return { style: { setProperty: (name: string, value: string) => (props[name] = value) }, props };
}

describe("attachAppHeight", () => {
  it("publishes the visual viewport height immediately", () => {
    const target = fakeTarget();
    attachAppHeight({ viewport: fakeViewport(812), target, onWindowResize: () => () => {} });

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("812px");
  });

  // The whole point: an open keyboard shrinks visualViewport.height, and the
  // shell has to shrink with it or the keyboard just covers the bottom.
  it("follows the viewport shrinking when the keyboard opens", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(812);
    attachAppHeight({ viewport, target, onWindowResize: () => () => {} });

    viewport.height = 476; // keyboard up
    viewport.emit("resize");

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("476px");
  });

  // iOS reports the shift that scrolls a focused field above the keyboard as a
  // visualViewport SCROLL, not a resize.
  it("also updates on a visual viewport scroll", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(812);
    attachAppHeight({ viewport, target, onWindowResize: () => () => {} });

    viewport.height = 500;
    viewport.emit("scroll");

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("500px");
  });

  // A px value must be written even without visualViewport: the CSS fallback is
  // `100dvh`, which is invalid at computed-value time on a browser that has
  // custom properties but not dvh units, collapsing the shell to height:auto.
  it("falls back to the window height when there is no visual viewport", () => {
    const target = fakeTarget();
    attachAppHeight({ viewport: null, fallbackHeight: () => 640, target, onWindowResize: () => () => {} });

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("640px");
  });

  // Some browsers report a transient 0 mid-rotation; committing it would
  // collapse the shell for a frame.
  it("ignores a non-positive height rather than committing it", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(812);
    attachAppHeight({ viewport, target, onWindowResize: () => () => {} });

    viewport.height = 0;
    viewport.emit("resize");

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("812px");
  });

  it("removes every listener it added on cleanup", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(812);
    const detachWindow = vi.fn();
    const detach = attachAppHeight({ viewport, target, onWindowResize: () => detachWindow });

    expect(viewport.listenerCount()).toBe(2);
    detach();

    expect(viewport.listenerCount()).toBe(0);
    expect(detachWindow).toHaveBeenCalledOnce();
  });
});
