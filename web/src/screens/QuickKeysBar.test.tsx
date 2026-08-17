import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VirtualKeyName } from "../domain/virtualKeys";
import { QuickKeysBar } from "./QuickKeysBar";

describe("QuickKeysBar", () => {
  afterEach(() => {
    cleanup();
  });

  // ^D lives in the ctrl pad now, not here -- the normal row's eight slots
  // belong to the keys a phone shell needs on every screen, and ^D (EOF on an
  // empty prompt) lost its slot to the ctrl pad's own toggle.
  it("renders the always-visible quick keys and sends the right raw sequence for each", () => {
    const onKeyTap = vi.fn();
    render(() => <QuickKeysBar onKeyTap={onKeyTap} />);

    fireEvent.click(screen.getByRole("button", { name: "Esc" }));
    fireEvent.click(screen.getByRole("button", { name: "Tab" }));
    fireEvent.click(screen.getByRole("button", { name: "^C" }));
    fireEvent.click(screen.getByRole("button", { name: "^B" }));

    expect(onKeyTap).toHaveBeenNthCalledWith(1, "\x1b");
    expect(onKeyTap).toHaveBeenNthCalledWith(2, "\t");
    expect(onKeyTap).toHaveBeenNthCalledWith(3, "\x03");
    expect(onKeyTap).toHaveBeenNthCalledWith(4, "\x02");
    expect(screen.queryByRole("button", { name: "^D" })).toBeNull();
  });
});

describe("QuickKeysBar clipboard controls", () => {
  afterEach(() => {
    cleanup();
  });

  function renderBar(overrides: Partial<Parameters<typeof QuickKeysBar>[0]> = {}) {
    const props = {
      onKeyTap: vi.fn(),
      isSelecting: false,
      onToggleSelecting: vi.fn(),
      onCopy: vi.fn(),
      onClearSelection: vi.fn(),
      onPaste: vi.fn(),
      ...overrides,
    };
    render(() => <QuickKeysBar {...props} />);
    return props;
  }

  it("offers Select and Paste alongside the control keys when not selecting", () => {
    renderBar();

    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paste" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Esc" })).toBeInTheDocument();
  });

  it("toggles selection mode from Select", () => {
    const props = renderBar();

    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    expect(props.onToggleSelecting).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("opens the paste flow from Paste", () => {
    const props = renderBar();

    fireEvent.click(screen.getByRole("button", { name: "Paste" }));

    expect(props.onPaste).toHaveBeenCalledOnce();
  });

  // While selecting, the control keys would be actively harmful: every one of
  // them sends bytes to the shell, and a stray ^C mid-selection both
  // interrupts the running command and repaints the pane, which destroys the
  // very DOM nodes the selection is anchored to.
  it("replaces the control keys with Copy/Clear/Done while selecting", () => {
    renderBar({ isSelecting: true });

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Esc" })).toBeNull();
    expect(screen.queryByRole("button", { name: "^C" })).toBeNull();
  });

  it("copies from Copy without leaving selection mode", () => {
    const props = renderBar({ isSelecting: true });

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(props.onCopy).toHaveBeenCalledOnce();
    expect(props.onToggleSelecting).not.toHaveBeenCalled();
  });

  it("clears the selection from Clear without leaving selection mode", () => {
    const props = renderBar({ isSelecting: true });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(props.onClearSelection).toHaveBeenCalledOnce();
    expect(props.onToggleSelecting).not.toHaveBeenCalled();
  });

  it("leaves selection mode from Done", () => {
    const props = renderBar({ isSelecting: true });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(props.onToggleSelecting).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("marks Select as pressed while selection mode is active", () => {
    renderBar({ isSelecting: true });

    expect(screen.getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "true");
  });

  // No production caller omits these today (see QuickKeysBar.tsx's header --
  // TerminalScreen is the only render site and always wires them). This pins
  // the graceful-degradation behaviour anyway, so adding a caller that omits
  // them renders a smaller bar rather than crashing on an undefined handler.
  it("renders only the control keys when no clipboard handlers are provided", () => {
    render(() => <QuickKeysBar onKeyTap={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Esc" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Paste" })).toBeNull();
  });
});

describe("QuickKeysBar arrow mode", () => {
  afterEach(() => {
    cleanup();
  });

  function renderBar(overrides: Partial<Parameters<typeof QuickKeysBar>[0]> = {}) {
    const props = {
      onKeyTap: vi.fn(),
      isSelecting: false,
      onToggleSelecting: vi.fn(),
      onCopy: vi.fn(),
      onClearSelection: vi.fn(),
      onPaste: vi.fn(),
      isArrowMode: false,
      onToggleArrows: vi.fn(),
      onPressKey: vi.fn(),
      ...overrides,
    };
    render(() => <QuickKeysBar {...props} />);
    return props;
  }

  it("offers an arrow-keys toggle in the normal row", () => {
    renderBar();

    expect(screen.getByRole("button", { name: "Arrow keys" })).toBeInTheDocument();
  });

  it("enters arrow mode from the toggle", () => {
    const props = renderBar();

    fireEvent.click(screen.getByRole("button", { name: "Arrow keys" }));

    expect(props.onToggleArrows).toHaveBeenCalledExactlyOnceWith(true);
  });

  // A stray ^C during a menu prompt would kill the very thing being answered,
  // so the control keys are replaced rather than kept alongside the arrows.
  it("replaces the control keys with the arrow pad while in arrow mode", () => {
    renderBar({ isArrowMode: true });

    for (const label of ["Left", "Up", "Down", "Right", "Enter", "Shift Tab"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "^C" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Esc" })).toBeNull();
  });

  it("sends each arrow by key name, never as raw bytes", () => {
    const onPressKey = vi.fn<(name: VirtualKeyName) => void>();
    const props = renderBar({ isArrowMode: true, onPressKey });

    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    fireEvent.click(screen.getByRole("button", { name: "Down" }));
    fireEvent.click(screen.getByRole("button", { name: "Left" }));
    fireEvent.click(screen.getByRole("button", { name: "Right" }));
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    fireEvent.click(screen.getByRole("button", { name: "Shift Tab" }));

    expect(onPressKey.mock.calls.map(([name]) => name)).toEqual([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Enter",
      "ShiftTab",
    ]);
    // The raw-byte path is for the fixed-form control keys only; an arrow's
    // byte form depends on the terminal's cursor mode and is xterm's call.
    expect(props.onKeyTap).not.toHaveBeenCalled();
  });

  it("leaves arrow mode from Done", () => {
    const props = renderBar({ isArrowMode: true });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(props.onToggleArrows).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("shows the selection controls, not the arrow pad, when both flags are somehow set", () => {
    renderBar({ isArrowMode: true, isSelecting: true });

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Up" })).toBeNull();
  });

  it("renders no arrow toggle when the handler is not wired (desktop pane)", () => {
    render(() => <QuickKeysBar onKeyTap={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Arrow keys" })).toBeNull();
  });
});

describe("QuickKeysBar ctrl mode", () => {
  afterEach(() => {
    cleanup();
  });

  function renderBar(overrides: Partial<Parameters<typeof QuickKeysBar>[0]> = {}) {
    const props = {
      onKeyTap: vi.fn(),
      isSelecting: false,
      onToggleSelecting: vi.fn(),
      onCopy: vi.fn(),
      onClearSelection: vi.fn(),
      onPaste: vi.fn(),
      isArrowMode: false,
      onToggleArrows: vi.fn(),
      onPressKey: vi.fn(),
      isCtrlMode: false,
      onToggleCtrl: vi.fn(),
      ...overrides,
    };
    render(() => <QuickKeysBar {...props} />);
    return props;
  }

  it("offers a ctrl toggle in the normal row", () => {
    renderBar();

    expect(screen.getByRole("button", { name: "Control keys" })).toBeInTheDocument();
  });

  it("enters ctrl mode from the toggle", () => {
    const props = renderBar();

    fireEvent.click(screen.getByRole("button", { name: "Control keys" }));

    expect(props.onToggleCtrl).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("marks the ctrl toggle aria-pressed=false in the normal row", () => {
    renderBar();

    expect(screen.getByRole("button", { name: "Control keys" })).toHaveAttribute("aria-pressed", "false");
  });

  // Same reasoning as arrow mode: a stray Esc/Tab while picking a ctrl key
  // sends bytes meant for the shell, so the whole row is replaced.
  it("replaces the control keys with the ctrl pad while in ctrl mode", () => {
    renderBar({ isCtrlMode: true });

    expect(screen.queryByRole("button", { name: "Esc" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tab" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Arrow keys" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Paste" })).toBeNull();
  });

  it("sends the right raw byte for every key in the ctrl pad", () => {
    const onKeyTap = vi.fn();
    renderBar({ isCtrlMode: true, onKeyTap });

    const expected: [string, string][] = [
      ["^A", "\x01"],
      ["^B", "\x02"],
      ["^C", "\x03"],
      ["^D", "\x04"],
      ["^E", "\x05"],
      ["^K", "\x0b"],
      ["^L", "\x0c"],
      ["^R", "\x12"],
      ["^U", "\x15"],
      ["^W", "\x17"],
      ["^Z", "\x1a"],
    ];
    for (const [label] of expected) {
      fireEvent.click(screen.getByRole("button", { name: label }));
    }

    expect(onKeyTap.mock.calls.map(([sequence]) => sequence)).toEqual(expected.map(([, sequence]) => sequence));
  });

  it("stays in ctrl mode after tapping a ctrl key (unlike the one-shot normal keys)", () => {
    const props = renderBar({ isCtrlMode: true });

    fireEvent.click(screen.getByRole("button", { name: "^A" }));

    expect(props.onToggleCtrl).not.toHaveBeenCalled();
  });

  it("leaves ctrl mode from Done", () => {
    const props = renderBar({ isCtrlMode: true });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(props.onToggleCtrl).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("marks Done aria-pressed=true while in ctrl mode", () => {
    renderBar({ isCtrlMode: true });

    expect(screen.getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "true");
  });

  // Selection wins over every other mode, same guard as arrows: two mode
  // rows stacked on top of each other would leave one unreachable.
  it("shows the selection controls, not the ctrl pad, when selecting and ctrl flags are both set", () => {
    renderBar({ isCtrlMode: true, isSelecting: true });

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "^A" })).toBeNull();
  });

  it("shows the arrow pad, not the ctrl pad, when both flags are somehow set", () => {
    renderBar({ isCtrlMode: true, isArrowMode: true });

    expect(screen.getByRole("button", { name: "Up" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "^A" })).toBeNull();
  });

  it("renders no ctrl toggle when the handler is not wired", () => {
    render(() => <QuickKeysBar onKeyTap={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Control keys" })).toBeNull();
  });
});
