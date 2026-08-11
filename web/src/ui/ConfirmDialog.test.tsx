import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the title and message, and fires onConfirm/onCancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(() => (
      <ConfirmDialog title="Delete project" message="This can't be undone." onConfirm={onConfirm} onCancel={onCancel} />
    ));

    expect(screen.getByText("Delete project")).toBeInTheDocument();
    expect(screen.getByText("This can't be undone.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(onConfirm).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows the escalated force-delete label and warning banner only when force is set", () => {
    const { unmount } = render(() => (
      <ConfirmDialog title="Delete project" message="msg" onConfirm={vi.fn()} onCancel={vi.fn()} />
    ));
    expect(screen.queryByText("Active sessions will be killed.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Force delete" })).toBeNull();
    unmount();

    render(() => (
      <ConfirmDialog title="Delete project" message="msg" onConfirm={vi.fn()} onCancel={vi.fn()} force />
    ));
    expect(screen.getByText("Active sessions will be killed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Force delete" })).toBeInTheDocument();
  });

  it("calls onCancel when the scrim is clicked but not when the dialog panel is clicked", () => {
    const onCancel = vi.fn();
    const { container } = render(() => (
      <ConfirmDialog title="Delete project" message="msg" onConfirm={vi.fn()} onCancel={onCancel} />
    ));

    fireEvent.click(screen.getByText("msg"));
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector(".tw-sheet-scrim") as HTMLElement);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders extra content between the message and the footer", () => {
    render(() => (
      <ConfirmDialog title="Delete branch?" message="msg" onConfirm={vi.fn()} onCancel={vi.fn()}>
        <label>
          <input type="checkbox" /> Delete branch too
        </label>
      </ConfirmDialog>
    ));

    expect(screen.getByText("Delete branch too")).toBeInTheDocument();
  });

  // Every action behind this dialog is a real round trip (killing tmux
  // sessions, removing git worktrees). Without feedback the dialog just sat
  // there looking unclicked until it vanished.
  it("shows a spinner on the confirm button while an async onConfirm is in flight", async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(() => <ConfirmDialog title="Delete project" message="msg" onConfirm={onConfirm} onCancel={vi.fn()} />);

    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(confirm.querySelector(".tw-button__spinner")).toBeNull();

    fireEvent.click(confirm);
    await Promise.resolve();

    const busy = screen.getByRole("button", { name: /Delete/ });
    expect(busy.querySelector(".tw-button__spinner")).not.toBeNull();
    expect(busy).toBeDisabled();
    // Cancel is locked too: the work does not stop just because the dialog closed.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByRole("button", { name: "Cancel" })).not.toBeDisabled();
  });

  // These actions are not idempotent -- a second force-delete would target
  // whatever now occupies the name.
  it("ignores a second confirm click while the first is still running", async () => {
    const onConfirm = vi.fn(() => new Promise<void>(() => {}));
    render(() => <ConfirmDialog title="Delete project" message="msg" onConfirm={onConfirm} onCancel={vi.fn()} />);

    const confirm = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(confirm);
    await Promise.resolve();
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  // Clearing the pending state on failure too, so a dialog that stays open to
  // show an error is still retryable rather than stuck spinning.
  it("clears the pending state when onConfirm rejects", async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error("boom")));
    render(() => <ConfirmDialog title="Delete project" message="msg" onConfirm={onConfirm} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByRole("button", { name: "Cancel" })).not.toBeDisabled();
  });

  // A call site that returns nothing keeps the old fire-and-forget behaviour
  // rather than getting a spinner that would never resolve.
  it("does not enter a pending state for a synchronous onConfirm", () => {
    const onConfirm = vi.fn();
    render(() => <ConfirmDialog title="Delete project" message="msg" onConfirm={onConfirm} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("button", { name: "Cancel" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" }).querySelector(".tw-button__spinner")).toBeNull();
  });
});
