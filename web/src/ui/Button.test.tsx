import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the label and calls onClick when pressed", () => {
    const onClick = vi.fn();
    render(() => <Button label="Connect" onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not call onClick when disabled", () => {
    const onClick = vi.fn();
    render(() => <Button label="Connect" onClick={onClick} disabled />);

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("disables the button and shows a spinner while loading, hiding the leading icon", () => {
    render(() => <Button label="Save" loading icon={<span>icon</span>} />);

    const button = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector(".tw-button__spinner")).not.toBeNull();
    expect(screen.queryByText("icon")).toBeNull();
  });

  it("reflects variant and size as data attributes for styling", () => {
    render(() => <Button label="Delete" variant="danger" size="lg" />);

    const button = screen.getByRole("button", { name: "Delete" });
    expect(button.getAttribute("data-variant")).toBe("danger");
    expect(button.getAttribute("data-size")).toBe("lg");
  });

  it("defaults to primary/md when no variant or size is given", () => {
    render(() => <Button label="Go" />);

    const button = screen.getByRole("button", { name: "Go" });
    expect(button.getAttribute("data-variant")).toBe("primary");
    expect(button.getAttribute("data-size")).toBe("md");
  });

  it("applies the fill-width class when fillWidth is set", () => {
    render(() => <Button label="Go" fillWidth />);

    expect(screen.getByRole("button", { name: "Go" }).classList).toContain("tw-button--fill");
  });
});
