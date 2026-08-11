import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionBanner } from "./ConnectionBanner";

describe("ConnectionBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the default label for each status", () => {
    const { unmount: u1 } = render(() => <ConnectionBanner status="disconnected" />);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    u1();

    const { unmount: u2 } = render(() => <ConnectionBanner status="reconnecting" />);
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    u2();

    render(() => <ConnectionBanner status="connected" />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("prefers a custom message over the default label", () => {
    render(() => <ConnectionBanner status="disconnected" message="Server unreachable" />);

    expect(screen.getByText("Server unreachable")).toBeInTheDocument();
    expect(screen.queryByText("Disconnected")).toBeNull();
  });

  it("renders a retry button only when onRetry is given, and fires it on click", () => {
    const onRetry = vi.fn();
    const { unmount } = render(() => <ConnectionBanner status="disconnected" />);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    unmount();

    render(() => <ConnectionBanner status="disconnected" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("only applies the spin class while reconnecting", () => {
    const { container, unmount } = render(() => <ConnectionBanner status="reconnecting" />);
    expect(container.querySelector(".tw-connection-banner__icon--spin")).not.toBeNull();
    unmount();

    const { container: container2 } = render(() => <ConnectionBanner status="connected" />);
    expect(container2.querySelector(".tw-connection-banner__icon--spin")).toBeNull();
  });
});
