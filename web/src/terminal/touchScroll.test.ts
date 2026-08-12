import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { attachTouchScroll } from "./touchScroll";

function touchEvent(type: string, clientY: number, touchCount = 1, clientX = 7): Event {
  const event = new Event(type, { cancelable: type === "touchmove" });
  Object.defineProperty(event, "touches", {
    value: Array.from({ length: touchCount }, () => ({ clientX, clientY })),
  });
  return event;
}

describe("attachTouchScroll", () => {
  let container: HTMLDivElement;
  let onStart: Mock<() => void>;
  let onDrag: Mock<(deltaY: number, point: { clientX: number; clientY: number }) => void>;
  let detach: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    onStart = vi.fn();
    onDrag = vi.fn();
    detach = attachTouchScroll(container, { onStart, onDrag });
  });

  afterEach(() => {
    detach();
  });

  it("calls onStart on a single-finger touchstart", () => {
    container.dispatchEvent(touchEvent("touchstart", 100));

    expect(onStart).toHaveBeenCalledOnce();
  });

  it("ignores a multi-finger touchstart (pinch-zoom is not ours to interpret)", () => {
    container.dispatchEvent(touchEvent("touchstart", 100, 2));

    expect(onStart).not.toHaveBeenCalled();
  });

  it("reports the pixel delta between successive touchmove events", () => {
    container.dispatchEvent(touchEvent("touchstart", 100));
    container.dispatchEvent(touchEvent("touchmove", 130));

    expect(onDrag).toHaveBeenCalledWith(30, { clientX: 7, clientY: 130 });
  });

  it("accumulates from the last reported position, not the original start", () => {
    container.dispatchEvent(touchEvent("touchstart", 100));
    container.dispatchEvent(touchEvent("touchmove", 130));
    container.dispatchEvent(touchEvent("touchmove", 110));

    expect(onDrag).toHaveBeenLastCalledWith(-20, { clientX: 7, clientY: 110 });
  });

  it("does not call onDrag when the finger hasn't moved", () => {
    container.dispatchEvent(touchEvent("touchstart", 100));
    container.dispatchEvent(touchEvent("touchmove", 100));

    expect(onDrag).not.toHaveBeenCalled();
  });

  it("calls preventDefault on touchmove to stop iOS rubber-band overscroll", () => {
    container.dispatchEvent(touchEvent("touchstart", 100));
    const moveEvent = touchEvent("touchmove", 130);
    const preventDefault = vi.spyOn(moveEvent, "preventDefault");

    container.dispatchEvent(moveEvent);

    expect(preventDefault).toHaveBeenCalled();
  });

  it("ignores a multi-finger touchmove", () => {
    container.dispatchEvent(touchEvent("touchstart", 100));
    container.dispatchEvent(touchEvent("touchmove", 130, 2));

    expect(onDrag).not.toHaveBeenCalled();
  });

  it("the returned cleanup function removes both listeners", () => {
    detach();

    container.dispatchEvent(touchEvent("touchstart", 100));

    expect(onStart).not.toHaveBeenCalled();
  });
});

// Selection mode (the mobile copy flow) hands the gesture back to the
// browser: iOS drives its own long-press selection and drag handles through
// touchmove, so a preventDefault here cancels the drag handles outright and
// the user can never adjust what they selected.
describe("attachTouchScroll with an isEnabled guard", () => {
  let container: HTMLDivElement;
  let onStart: Mock<() => void>;
  let onDrag: Mock<(deltaY: number, point: { clientX: number; clientY: number }) => void>;
  let enabled: boolean;
  let detach: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    onStart = vi.fn();
    onDrag = vi.fn();
    enabled = true;
    detach = attachTouchScroll(container, { onStart, onDrag, isEnabled: () => enabled });
  });

  afterEach(() => {
    detach();
  });

  it("does not preventDefault on touchmove while disabled", () => {
    enabled = false;
    container.dispatchEvent(touchEvent("touchstart", 100));
    const moveEvent = touchEvent("touchmove", 130);
    const preventDefault = vi.spyOn(moveEvent, "preventDefault");

    container.dispatchEvent(moveEvent);

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("does not report scroll while disabled", () => {
    enabled = false;

    container.dispatchEvent(touchEvent("touchstart", 100));
    container.dispatchEvent(touchEvent("touchmove", 130));

    expect(onStart).not.toHaveBeenCalled();
    expect(onDrag).not.toHaveBeenCalled();
  });

  it("reads the guard per event so toggling the mode takes effect without re-attaching", () => {
    enabled = false;
    container.dispatchEvent(touchEvent("touchstart", 100));
    container.dispatchEvent(touchEvent("touchmove", 130));

    enabled = true;
    container.dispatchEvent(touchEvent("touchstart", 100));
    container.dispatchEvent(touchEvent("touchmove", 130));

    expect(onDrag).toHaveBeenCalledExactlyOnceWith(30, { clientX: 7, clientY: 130 });
  });

  it("still scrolls normally while enabled", () => {
    container.dispatchEvent(touchEvent("touchstart", 100));
    container.dispatchEvent(touchEvent("touchmove", 130));

    expect(onDrag).toHaveBeenCalledWith(30, { clientX: 7, clientY: 130 });
  });
});
