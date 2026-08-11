import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the label and reflects the tone as a data attribute", () => {
    render(() => <StatusBadge label="Connected" tone="connected" />);

    const badge = screen.getByText("Connected");
    expect(badge.closest(".tw-badge")?.getAttribute("data-tone")).toBe("connected");
  });

  it("renders no dot by default", () => {
    const { container } = render(() => <StatusBadge label="Idle" tone="idle" />);

    expect(container.querySelector(".tw-badge__dot")).toBeNull();
  });

  it("renders a dot when dot is set, with the pulse class only when pulse is also set", () => {
    const { container } = render(() => <StatusBadge label="Live" tone="reconnecting" dot pulse />);

    const dot = container.querySelector(".tw-badge__dot");
    expect(dot).not.toBeNull();
    expect(dot?.classList).toContain("tw-badge__dot--pulse");
  });

  it("does not add the pulse class when dot is set but pulse is not", () => {
    const { container } = render(() => <StatusBadge label="Attached" tone="attached" dot />);

    expect(container.querySelector(".tw-badge__dot")?.classList).not.toContain("tw-badge__dot--pulse");
  });
});
