import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowTabs } from "./WindowTabs";

function renderTabs(overrides: Partial<Parameters<typeof WindowTabs>[0]> = {}) {
  const onSelectWindow = vi.fn();
  const onWindowsChanged = vi.fn();
  const onInput = vi.fn();
  render(() => (
    <WindowTabs
      windowCount={2}
      activeWindow={0}
      serverWindowNames={["main", "logs"]}
      onSelectWindow={onSelectWindow}
      onWindowsChanged={onWindowsChanged}
      onInput={onInput}
      wait={() => Promise.resolve()}
      {...overrides}
    />
  ));
  return { onSelectWindow, onWindowsChanged, onInput };
}

describe("WindowTabs", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders one tab per window with its name, marking the active one", () => {
    renderTabs({ activeWindow: 1 });

    expect(screen.getByRole("tab", { name: "0: main" })).toBeInTheDocument();
    const active = screen.getByRole("tab", { name: "1: logs" });
    expect(active.getAttribute("aria-selected")).toBe("true");
  });

  it("switching tabs sends a raw Ctrl-B <digit> prefix keystroke", () => {
    const { onSelectWindow, onInput } = renderTabs();

    fireEvent.click(screen.getByRole("tab", { name: "1: logs" }));

    expect(onInput).toHaveBeenCalledWith("\x021");
    expect(onSelectWindow).toHaveBeenCalledWith(1);
  });

  it("opening a new window sends Ctrl-B c and refetches after the delay", async () => {
    const { onSelectWindow, onInput, onWindowsChanged } = renderTabs();

    fireEvent.click(screen.getByRole("button", { name: "New window" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(onSelectWindow).toHaveBeenCalledWith(2);
    expect(onInput).toHaveBeenCalledWith("\x02c");
    expect(onWindowsChanged).toHaveBeenCalledOnce();
  });

  // Creating a window is a raw Ctrl-B c keystroke with nothing to await, so the
  // real tab only appears once the delayed refetch reports a higher count.
  // Without an optimistic placeholder the strip renders no tab for it at all in
  // the meantime, while onSelectWindow has already made that index active --
  // a tab bar with nothing selected, which is what read as "blank".
  it("shows a placeholder tab immediately when a new window is requested", () => {
    renderTabs();

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "New window" }));

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    // A spinner, not a name: the window has no server-assigned name yet.
    expect(tabs[2].querySelector(".tw-window-tab__spinner")).not.toBeNull();
    expect(tabs[2]).toBeDisabled();
    expect(tabs[2]).toHaveAttribute("aria-busy", "true");
    // the spinner is aria-hidden, so the button needs its own accessible name
    expect(tabs[2]).toHaveAttribute("aria-label", "Window 2, creating");
  });

  // Rename and close address a window by index in a tmux command; firing one at
  // an index tmux has not created yet would hit whatever later occupies it.
  it("withholds rename and close on the placeholder tab", () => {
    renderTabs();

    fireEvent.click(screen.getByRole("button", { name: "New window" }));

    expect(screen.queryByRole("button", { name: "Rename window 2" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close window 2" })).toBeNull();
    // the real tabs keep theirs
    expect(screen.getByRole("button", { name: "Rename window 1" })).toBeInTheDocument();
  });

  it("replaces the placeholder with the real tab once the server count catches up", () => {
    const [count, setCount] = createSignal(2);
    const [names, setNames] = createSignal(["main", "logs"]);
    render(() => (
      <WindowTabs
        windowCount={count()}
        activeWindow={0}
        serverWindowNames={names()}
        onSelectWindow={vi.fn()}
        onWindowsChanged={vi.fn()}
        onInput={vi.fn()}
        wait={() => Promise.resolve()}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "New window" }));
    expect(screen.getAllByRole("tab")[2].querySelector(".tw-window-tab__spinner")).not.toBeNull();

    // the refetch lands
    setNames(["main", "logs", "shell"]);
    setCount(3);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[2]).toHaveTextContent("2: shell");
    expect(tabs[2].querySelector(".tw-window-tab__spinner")).toBeNull();
    expect(tabs[2]).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Close window 2" })).toBeInTheDocument();
  });

  it("closing a window asks for confirmation, then sends a kill-window command line and refetches", async () => {
    const { onInput, onSelectWindow, onWindowsChanged } = renderTabs();

    fireEvent.click(screen.getByRole("button", { name: "Close window 1" }));
    expect(screen.getByText(/Close window 1: logs/)).toBeInTheDocument();
    expect(onInput).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onInput).toHaveBeenNthCalledWith(1, "\x02:");
    expect(onInput).toHaveBeenNthCalledWith(2, "kill-window -t 1 ; move-window -r");
    expect(onInput).toHaveBeenNthCalledWith(3, "\r");
    expect(onSelectWindow).toHaveBeenCalledWith(0);
    expect(onWindowsChanged).toHaveBeenCalledOnce();
  });

  it("cancelling the close-window confirm sends nothing", () => {
    const { onInput } = renderTabs();

    fireEvent.click(screen.getByRole("button", { name: "Close window 0" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onInput).not.toHaveBeenCalled();
    expect(screen.queryByText(/Close window 0/)).toBeNull();
  });

  it("renaming a window sends a rename-window command line with the escaped name", async () => {
    const { onInput, onWindowsChanged } = renderTabs();

    fireEvent.click(screen.getByRole("button", { name: "Rename window 0" }));
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.value).toBe("main");
    fireEvent.input(input, { target: { value: 'build "prod"' } });
    fireEvent.click(screen.getByText("Save"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onInput).toHaveBeenNthCalledWith(2, 'rename-window -t 0 "build \\"prod\\""');
    expect(onWindowsChanged).toHaveBeenCalledOnce();
    expect(screen.getByRole("tab", { name: /build "prod"/ })).toBeInTheDocument();
  });
});
