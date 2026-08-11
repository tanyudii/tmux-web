import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionLabelSheet } from "./SessionLabelSheet";

describe("SessionLabelSheet", () => {
  afterEach(() => {
    cleanup();
  });

  it("pre-fills the field from initialLabel and saves the trimmed value", () => {
    const onSave = vi.fn();
    render(() => <SessionLabelSheet initialLabel="backend" onSave={onSave} onCancel={vi.fn()} />);

    expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("backend");

    fireEvent.input(screen.getByLabelText("Label"), { target: { value: "  frontend  " } });
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith("frontend");
  });

  it("saves null when the trimmed value is empty, clearing the label", () => {
    const onSave = vi.fn();
    render(() => <SessionLabelSheet initialLabel="backend" onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.input(screen.getByLabelText("Label"), { target: { value: "   " } });
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("starts empty when there is no initial label", () => {
    render(() => <SessionLabelSheet initialLabel={null} onSave={vi.fn()} onCancel={vi.fn()} />);

    expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("");
  });
});
