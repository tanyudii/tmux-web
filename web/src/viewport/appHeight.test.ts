import { describe, expect, it, vi } from "vitest";
import { attachAppHeight, APP_HEIGHT_PROPERTY } from "./appHeight";

// Numbers throughout are the ones measured on the reporting devices:
//   layout viewport 1024 (iPad portrait)
//   software keyboard -> visual viewport 545  (479px overlap, ~47%)
//   accessory bar     -> visual viewport 953  (71px overlap,  ~7%)
//   stale/transient   -> visual viewport 866  (158px overlap, ~15%)
const LAYOUT = 1024;
const KEYBOARD = 545;
const ACCESSORY_BAR = 953;
const STALE = 866;

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

/** Inert defaults so each test only states what it is actually about. */
function attach(overrides: Parameters<typeof attachAppHeight>[0] = {}) {
  return attachAppHeight({
    fallbackHeight: () => LAYOUT,
    isTextEntryFocused: () => true,
    onWindowResize: () => () => {},
    onFocusChange: () => () => {},
    scheduleSettle: () => {},
    ...overrides,
  });
}

describe("attachAppHeight", () => {
  it("publishes the visible height immediately", () => {
    const target = fakeTarget();
    attach({ viewport: fakeViewport(KEYBOARD), target });

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe(`${KEYBOARD}px`);
  });

  // The whole point: an open keyboard shrinks visualViewport.height, and the
  // shell has to shrink with it or the keyboard just covers the bottom.
  it("follows the viewport shrinking when the keyboard opens", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(LAYOUT);
    attach({ viewport, target });

    viewport.height = KEYBOARD;
    viewport.emit("resize");

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe(`${KEYBOARD}px`);
  });

  // iOS reports the shift that scrolls a focused field above the keyboard as a
  // visualViewport SCROLL, not a resize.
  it("also updates on a visual viewport scroll", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(LAYOUT);
    attach({ viewport, target });

    viewport.height = KEYBOARD;
    viewport.emit("scroll");

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe(`${KEYBOARD}px`);
  });

  // Reported from a real iPad: with a hardware keyboard attached, iPadOS
  // reserves ~71px for the shortcut bar and reports it exactly like a keyboard,
  // but nothing was drawn there -- so shrinking left a strip of dead space that
  // grew while typing.
  it("ignores an accessory-bar-sized overlap while typing", () => {
    const target = fakeTarget();
    attach({ viewport: fakeViewport(ACCESSORY_BAR), target, isTextEntryFocused: () => true });

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe(`${LAYOUT}px`);
  });

  // Same device, nothing focused: the reported overlap oscillated between 158px
  // and 71px on its own. Nothing can cover the page when nothing is focused.
  it("ignores a stale shrunken viewport while nothing is focused", () => {
    const target = fakeTarget();
    attach({ viewport: fakeViewport(STALE), target, isTextEntryFocused: () => false });

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe(`${LAYOUT}px`);
  });

  it("shrinks again as soon as a field takes focus and a real keyboard opens", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(KEYBOARD);
    let focused = false;
    let notify = () => {};
    attach({
      viewport,
      target,
      isTextEntryFocused: () => focused,
      onFocusChange: (l) => {
        notify = l;
        return () => {};
      },
    });
    expect(target.props[APP_HEIGHT_PROPERTY]).toBe(`${LAYOUT}px`);

    focused = true;
    notify();

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe(`${KEYBOARD}px`);
  });

  // iOS's first value mid-transition is often not the one it settles on.
  it("re-reads once after the transition settles", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(KEYBOARD);
    let settle = () => {};
    attach({ viewport, target, scheduleSettle: (run) => (settle = run) });

    viewport.emit("resize");
    expect(target.props[APP_HEIGHT_PROPERTY]).toBe(`${KEYBOARD}px`);

    viewport.height = ACCESSORY_BAR; // keyboard went away, only the bar is left
    settle();

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe(`${LAYOUT}px`);
  });

  // A px value must be written even without visualViewport: the CSS fallback is
  // `100dvh`, which is invalid at computed-value time on a browser that has
  // custom properties but not dvh units, collapsing the shell to height:auto.
  it("falls back to the window height when there is no visual viewport", () => {
    const target = fakeTarget();
    attach({ viewport: null, fallbackHeight: () => 640, target });

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe("640px");
  });

  // Some browsers report a transient 0 mid-rotation; committing it would
  // collapse the shell for a frame.
  it("ignores a non-positive height rather than committing it", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(KEYBOARD);
    attach({ viewport, target });

    viewport.height = 0;
    viewport.emit("resize");

    expect(target.props[APP_HEIGHT_PROPERTY]).toBe(`${KEYBOARD}px`);
  });

  it("removes every listener it added on cleanup", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(KEYBOARD);
    const detachWindow = vi.fn();
    const detachFocus = vi.fn();
    const detach = attach({
      viewport,
      target,
      onWindowResize: () => detachWindow,
      onFocusChange: () => detachFocus,
    });

    expect(viewport.listenerCount()).toBe(2);
    detach();

    expect(viewport.listenerCount()).toBe(0);
    expect(detachWindow).toHaveBeenCalledOnce();
    expect(detachFocus).toHaveBeenCalledOnce();
  });
});
