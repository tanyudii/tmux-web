import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { attachOptionDragCaptureListener } from "./optionDrag";

function mouseEvent(type: string, x: number, y: number, options: { altKey?: boolean; button?: number } = {}): MouseEvent {
  return new MouseEvent(type, { clientX: x, clientY: y, altKey: options.altKey ?? false, button: options.button ?? 0 });
}

describe("attachOptionDragCaptureListener", () => {
  let container: HTMLDivElement;
  let onDragEnded: Mock<() => void>;
  let detach: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    onDragEnded = vi.fn();
    detach = attachOptionDragCaptureListener(container, onDragEnded);
  });

  afterEach(() => {
    detach();
    container.remove();
  });

  it("fires onDragEnded for an Option-held drag past the movement threshold", () => {
    document.dispatchEvent(mouseEvent("mousedown", 0, 0, { altKey: true }));
    document.dispatchEvent(mouseEvent("mouseup", 20, 20));

    expect(onDragEnded).toHaveBeenCalledOnce();
  });

  it("does not fire for a plain click with no movement (no accidental relay)", () => {
    document.dispatchEvent(mouseEvent("mousedown", 0, 0, { altKey: true }));
    document.dispatchEvent(mouseEvent("mouseup", 0, 0));

    expect(onDragEnded).not.toHaveBeenCalled();
  });

  it("does not fire below the movement threshold", () => {
    document.dispatchEvent(mouseEvent("mousedown", 0, 0, { altKey: true }));
    document.dispatchEvent(mouseEvent("mouseup", 2, 0));

    expect(onDragEnded).not.toHaveBeenCalled();
  });

  it("ignores a drag started without the Option/Alt key", () => {
    document.dispatchEvent(mouseEvent("mousedown", 0, 0, { altKey: false }));
    document.dispatchEvent(mouseEvent("mouseup", 20, 20));

    expect(onDragEnded).not.toHaveBeenCalled();
  });

  it("ignores a non-primary mouse button", () => {
    document.dispatchEvent(mouseEvent("mousedown", 0, 0, { altKey: true, button: 2 }));
    document.dispatchEvent(mouseEvent("mouseup", 20, 20));

    expect(onDragEnded).not.toHaveBeenCalled();
  });

  it("only reacts once per mousedown (the mouseup listener detaches itself)", () => {
    document.dispatchEvent(mouseEvent("mousedown", 0, 0, { altKey: true }));
    document.dispatchEvent(mouseEvent("mouseup", 20, 20));
    document.dispatchEvent(mouseEvent("mouseup", 40, 40));

    expect(onDragEnded).toHaveBeenCalledOnce();
  });

  it("the returned cleanup function removes the mousedown listener", () => {
    detach();

    document.dispatchEvent(mouseEvent("mousedown", 0, 0, { altKey: true }));
    document.dispatchEvent(mouseEvent("mouseup", 20, 20));

    expect(onDragEnded).not.toHaveBeenCalled();
  });
});
