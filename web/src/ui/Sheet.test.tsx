import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the title, action label, and content", () => {
    render(() => (
      <Sheet title="New project" actionLabel="Add" onDismiss={vi.fn()} onAction={vi.fn()}>
        <p>form fields</p>
      </Sheet>
    ));

    expect(screen.getByText("New project")).toBeInTheDocument();
    expect(screen.getByText("Add")).toBeInTheDocument();
    expect(screen.getByText("form fields")).toBeInTheDocument();
  });

  it("calls onDismiss when Cancel or the scrim is clicked, but not when the panel is clicked", () => {
    const onDismiss = vi.fn();
    const { container } = render(() => (
      <Sheet title="New project" actionLabel="Add" onDismiss={onDismiss} onAction={vi.fn()}>
        <p>form fields</p>
      </Sheet>
    ));

    fireEvent.click(screen.getByText("form fields"));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Cancel"));
    expect(onDismiss).toHaveBeenCalledOnce();

    fireEvent.click(container.querySelector(".tw-sheet-scrim") as HTMLElement);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("calls onAction when the action label is clicked, and disables it when actionEnabled is false", () => {
    const onAction = vi.fn();
    render(() => (
      <Sheet title="New project" actionLabel="Add" onDismiss={vi.fn()} onAction={onAction} actionEnabled={false}>
        <p>form fields</p>
      </Sheet>
    ));

    const action = screen.getByText("Add") as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(onAction).not.toHaveBeenCalled();
  });
});
