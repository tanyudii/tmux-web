import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionFilterBar } from "./SessionFilterBar";

describe("SessionFilterBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks the active status chip and fires onStatusFilterChange for the others", () => {
    const onStatusFilterChange = vi.fn();
    render(() => (
      <SessionFilterBar
        statusFilter="active"
        onStatusFilterChange={onStatusFilterChange}
        branchQuery=""
        onBranchQueryChange={vi.fn()}
      />
    ));

    expect(screen.getByRole("button", { name: "Active" }).getAttribute("data-active")).toBe("true");
    expect(screen.getByRole("button", { name: "All" }).getAttribute("data-active")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Idle" }));
    expect(onStatusFilterChange).toHaveBeenCalledWith("idle");
  });

  it("reports branch query text as the user types", () => {
    const onBranchQueryChange = vi.fn();
    render(() => (
      <SessionFilterBar
        statusFilter="all"
        onStatusFilterChange={vi.fn()}
        branchQuery=""
        onBranchQueryChange={onBranchQueryChange}
      />
    ));

    fireEvent.input(screen.getByLabelText("Filter by branch"), { target: { value: "feature-x" } });

    expect(onBranchQueryChange).toHaveBeenCalledWith("feature-x");
  });
});
