import { beforeEach, describe, expect, it } from "vitest";
import { pressVirtualKey } from "./virtualKeys";

// Real @xterm/xterm cannot run under jsdom (see TerminalView.tsx's header),
// so what is asserted here is the dispatch contract: the right event, with
// the right shape, on the element xterm actually listens on. That the bytes
// xterm then emits are correct is not knowable from jsdom at all -- it was
// measured in a real browser instead (see domain/virtualKeys.ts's header).
describe("pressVirtualKey", () => {
  let container: HTMLDivElement;
  let textarea: HTMLTextAreaElement;
  let events: KeyboardEvent[];

  beforeEach(() => {
    container = document.createElement("div");
    textarea = document.createElement("textarea");
    textarea.className = "xterm-helper-textarea";
    container.appendChild(textarea);
    document.body.appendChild(container);
    events = [];
    textarea.addEventListener("keydown", (event) => events.push(event));
  });

  it("dispatches a keydown on xterm's own textarea", () => {
    const dispatched = pressVirtualKey(container, "ArrowUp");

    expect(dispatched).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].target).toBe(textarea);
  });

  it("sends the descriptor's key and code", () => {
    pressVirtualKey(container, "ArrowDown");

    expect(events[0].key).toBe("ArrowDown");
    expect(events[0].code).toBe("ArrowDown");
  });

  it("sets the shift modifier for Shift+Tab and not for the arrows", () => {
    pressVirtualKey(container, "ShiftTab");
    pressVirtualKey(container, "ArrowLeft");

    expect(events[0].key).toBe("Tab");
    expect(events[0].shiftKey).toBe(true);
    expect(events[1].shiftKey).toBe(false);
  });

  // xterm's listener sits on the textarea, but the event must still bubble
  // and be cancelable for xterm to be able to preventDefault it -- a
  // non-cancelable event would let the browser act on the key as well.
  it("dispatches a bubbling, cancelable event", () => {
    pressVirtualKey(container, "Enter");

    expect(events[0].bubbles).toBe(true);
    expect(events[0].cancelable).toBe(true);
  });

  it("reports false instead of throwing when xterm has not rendered its input yet", () => {
    const empty = document.createElement("div");

    expect(pressVirtualKey(empty, "ArrowUp")).toBe(false);
  });
});
