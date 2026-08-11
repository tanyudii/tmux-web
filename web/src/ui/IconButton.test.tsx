import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes an accessible name from the required label prop", () => {
    render(() => <IconButton icon={<span>x</span>} label="Close" />);

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("calls onClick when pressed", () => {
    const onClick = vi.fn();
    render(() => <IconButton icon={<span>x</span>} label="Close" onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not call onClick when disabled", () => {
    const onClick = vi.fn();
    render(() => <IconButton icon={<span>x</span>} label="Close" onClick={onClick} disabled />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("reflects variant and size as data attributes, defaulting to ghost/md", () => {
    render(() => <IconButton icon={<span>x</span>} label="Close" />);
    expect(screen.getByRole("button", { name: "Close" }).getAttribute("data-variant")).toBe("ghost");

    cleanup();
    render(() => <IconButton icon={<span>x</span>} label="Delete" variant="danger" size="sm" />);
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button.getAttribute("data-variant")).toBe("danger");
    expect(button.getAttribute("data-size")).toBe("sm");
  });
});
