import { describe, expect, it } from "vitest";
import { VIRTUAL_KEYS, type VirtualKeyName, virtualKeyDescriptor } from "./virtualKeys";

describe("virtualKeyDescriptor", () => {
  it("describes the four arrows with their legacy keyCodes", () => {
    // xterm's key evaluation still reads keyCode, so a wrong number here is
    // a silently dead button rather than a type error.
    expect(virtualKeyDescriptor("ArrowUp")).toEqual({ key: "ArrowUp", code: "ArrowUp", keyCode: 38, shiftKey: false });
    expect(virtualKeyDescriptor("ArrowDown")).toEqual({ key: "ArrowDown", code: "ArrowDown", keyCode: 40, shiftKey: false });
    expect(virtualKeyDescriptor("ArrowLeft")).toEqual({ key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, shiftKey: false });
    expect(virtualKeyDescriptor("ArrowRight")).toEqual({ key: "ArrowRight", code: "ArrowRight", keyCode: 39, shiftKey: false });
  });

  it("describes Enter", () => {
    expect(virtualKeyDescriptor("Enter")).toEqual({ key: "Enter", code: "Enter", keyCode: 13, shiftKey: false });
  });

  // Shift+Tab must be Tab-with-shift, not a key named "ShiftTab": xterm
  // derives ESC [ Z from the modifier, so dropping shiftKey would send a
  // plain Tab and quietly do the wrong thing.
  it("describes Shift+Tab as Tab with the shift modifier", () => {
    expect(virtualKeyDescriptor("ShiftTab")).toEqual({ key: "Tab", code: "Tab", keyCode: 9, shiftKey: true });
  });

  // Guards the design decision, not just the data: the moment someone
  // "helpfully" adds a hardcoded ESC [ A here, the mode-correctness that
  // dispatching through xterm buys us is thrown away.
  it("carries no escape sequences -- xterm derives the bytes from the cursor mode", () => {
    for (const descriptor of Object.values(VIRTUAL_KEYS)) {
      expect(JSON.stringify(descriptor)).not.toContain("\u001b");
    }
  });

  it("only ArrowUp/Down/Left/Right/Enter/ShiftTab are defined", () => {
    const names: VirtualKeyName[] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "ShiftTab"];
    expect(Object.keys(VIRTUAL_KEYS).sort()).toEqual([...names].sort());
  });
});
