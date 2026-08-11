import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBanner } from "./ErrorBanner";

describe("ErrorBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the message as an alert", () => {
    render(() => <ErrorBanner message="Failed to load projects" onDismiss={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load projects");
  });

  it("calls onDismiss when the dismiss button is pressed", () => {
    const onDismiss = vi.fn();
    render(() => <ErrorBanner message="Failed to load projects" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
