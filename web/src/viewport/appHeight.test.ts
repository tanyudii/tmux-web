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
    attachAppHeight({ viewport: fakeViewport(812), target, onWindowResize: () => () => {}, onFocusChange: () => () => {}, scheduleSettle: () => {}, isTextEntryFocused: () => true });

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("812px");
  });

  // The whole point: an open keyboard shrinks visualViewport.height, and the
  // shell has to shrink with it or the keyboard just covers the bottom.
  it("follows the viewport shrinking when the keyboard opens", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(812);
    attachAppHeight({ viewport, target, onWindowResize: () => () => {}, onFocusChange: () => () => {}, scheduleSettle: () => {}, isTextEntryFocused: () => true });

    viewport.height = 476; // keyboard up
    viewport.emit("resize");

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("476px");
  });

  // iOS reports the shift that scrolls a focused field above the keyboard as a
  // visualViewport SCROLL, not a resize.
  it("also updates on a visual viewport scroll", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(812);
    attachAppHeight({ viewport, target, onWindowResize: () => () => {}, onFocusChange: () => () => {}, scheduleSettle: () => {}, isTextEntryFocused: () => true });

    viewport.height = 500;
    viewport.emit("scroll");

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("500px");
  });

  // A px value must be written even without visualViewport: the CSS fallback is
  // `100dvh`, which is invalid at computed-value time on a browser that has
  // custom properties but not dvh units, collapsing the shell to height:auto.
  it("falls back to the window height when there is no visual viewport", () => {
    const target = fakeTarget();
    attachAppHeight({ viewport: null, fallbackHeight: () => 640, target, onWindowResize: () => () => {}, onFocusChange: () => () => {}, scheduleSettle: () => {}, isTextEntryFocused: () => true });

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("640px");
  });

  // Some browsers report a transient 0 mid-rotation; committing it would
  // collapse the shell for a frame.
  it("ignores a non-positive height rather than committing it", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(812);
    attachAppHeight({ viewport, target, onWindowResize: () => () => {}, onFocusChange: () => () => {}, scheduleSettle: () => {}, isTextEntryFocused: () => true });

    viewport.height = 0;
    viewport.emit("resize");

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("812px");
  });

  // Measured on a real iPad with a hardware keyboard and NOTHING focused: the
  // reported overlap oscillated between 158px and 71px on its own, so the shell
  // kept shrinking below the visible area and left a strip of dead space. With
  // nothing focused there is no keyboard and no accessory bar to hide behind,
  // so the layout viewport is the truth.
  it("ignores a stale shrunken viewport while nothing is focused", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(866); // iPadOS still claiming 158px is covered
    attachAppHeight({
      viewport, target, fallbackHeight: () => 1024,
      isTextEntryFocused: () => false,
      onWindowResize: () => () => {}, onFocusChange: () => () => {}, scheduleSettle: () => {},
    });

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("1024px");
  });

  it("shrinks again as soon as a field takes focus", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(545);
    let focused = false;
    let notify = () => {};
    attachAppHeight({
      viewport, target, fallbackHeight: () => 1024,
      isTextEntryFocused: () => focused,
      onFocusChange: (l) => { notify = l; return () => {}; },
      onWindowResize: () => () => {}, scheduleSettle: () => {},
    });
    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("1024px");

    focused = true;
    notify();

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("545px");
  });

  // iOS's first value mid-transition is often not the one it settles on.
  it("re-reads once after the transition settles", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(866);
    let settle = () => {};
    attachAppHeight({
      viewport, target, isTextEntryFocused: () => true,
      scheduleSettle: (run) => { settle = run; },
      onWindowResize: () => () => {}, onFocusChange: () => () => {},
    });

    viewport.emit("resize");
    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("866px");

    viewport.height = 953; // what iPadOS actually ends on
    settle();

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("953px");
  });

  it("removes every listener it added on cleanup", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(812);
    const detachWindow = vi.fn();
    const detachFocus = vi.fn();
    const detach = attachAppHeight({ viewport, target, onWindowResize: () => detachWindow, onFocusChange: () => detachFocus, scheduleSettle: () => {}, isTextEntryFocused: () => true });

    expect(viewport.listenerCount()).toBe(2);
    detach();

    expect(viewport.listenerCount()).toBe(0);
    expect(detachWindow).toHaveBeenCalledOnce();
    expect(detachFocus).toHaveBeenCalledOnce();
  });
});
