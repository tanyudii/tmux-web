import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a determinate fill width matching the given value", () => {
    const { container } = render(() => <ProgressBar value={40} label="Creating session" />);

    expect(screen.getByText("40%")).toBeInTheDocument();
    const fill = container.querySelector(".tw-progress__fill") as HTMLElement;
    expect(fill.style.width).toBe("40%");
  });

  it("clamps out-of-range values into 0-100", () => {
    const { container } = render(() => <ProgressBar value={150} />);

    const fill = container.querySelector(".tw-progress__fill") as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });

  it("renders the indeterminate sweep and no percentage when value is undefined", () => {
    const { container } = render(() => <ProgressBar label="Creating session" />);

    expect(container.querySelector(".tw-progress__sweep")).not.toBeNull();
    expect(container.querySelector(".tw-progress__fill")).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("renders no label row at all when label is omitted", () => {
    const { container } = render(() => <ProgressBar value={50} />);

    expect(container.querySelector(".tw-progress__label-row")).toBeNull();
  });
});
