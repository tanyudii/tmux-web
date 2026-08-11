import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VirtualKeyName } from "../domain/virtualKeys";
import { QuickKeysBar } from "./QuickKeysBar";

describe("QuickKeysBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders all five quick keys and sends the right raw sequence for each", () => {
    const onKeyTap = vi.fn();
    render(() => <QuickKeysBar onKeyTap={onKeyTap} />);

    fireEvent.click(screen.getByRole("button", { name: "Esc" }));
    fireEvent.click(screen.getByRole("button", { name: "Tab" }));
    fireEvent.click(screen.getByRole("button", { name: "^C" }));
    fireEvent.click(screen.getByRole("button", { name: "^B" }));
    fireEvent.click(screen.getByRole("button", { name: "^D" }));

    expect(onKeyTap).toHaveBeenNthCalledWith(1, "\x1b");
    expect(onKeyTap).toHaveBeenNthCalledWith(2, "\t");
    expect(onKeyTap).toHaveBeenNthCalledWith(3, "\x03");
    expect(onKeyTap).toHaveBeenNthCalledWith(4, "\x02");
    expect(onKeyTap).toHaveBeenNthCalledWith(5, "\x04");
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

  // The desktop pane renders this component too (it is hidden by a CSS media
  // query, not unmounted), and it has its own keyboard-driven copy/paste. It
  // must keep working with no clipboard props wired at all.
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
