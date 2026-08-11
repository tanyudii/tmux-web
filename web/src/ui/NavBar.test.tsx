import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavBar } from "./NavBar";

describe("NavBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the title inline (not as a heading) when not large", () => {
    render(() => <NavBar title="Projects" />);

    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("renders the title as a large heading when large is set", () => {
    render(() => <NavBar title="Connect" large />);

    expect(screen.getByRole("heading", { name: "Connect" })).toBeInTheDocument();
  });

  it("renders a back control and fires onClick, taking priority over a leading slot", () => {
    const onClick = vi.fn();
    render(() => (
      <NavBar title="Sessions" back={{ label: "Projects", onClick }} leading={<span>ignored</span>} />
    ));

    expect(screen.queryByText("ignored")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Projects/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders the leading slot when no back control is given", () => {
    render(() => <NavBar title="Projects" leading={<span>leading-slot</span>} />);

    expect(screen.getByText("leading-slot")).toBeInTheDocument();
  });

  it("renders the right slot", () => {
    render(() => <NavBar title="Projects" right={<span>right-slot</span>} />);

    expect(screen.getByText("right-slot")).toBeInTheDocument();
  });

  // In large mode the actions belong ON the headline row, not in the compact
  // bar above it -- on the project list that split left the "+" a full row
  // away from the "Projects" heading it acts on.
  it("puts leading and right slots on the headline row when large", () => {
    render(() => (
      <NavBar title="Projects" large leading={<span>lead</span>} right={<span>add</span>} />
    ));

    const headlineRow = screen.getByRole("heading", { name: "Projects" }).parentElement;
    expect(headlineRow).not.toBeNull();
    expect(headlineRow).toHaveClass("tw-navbar__large");
    expect(headlineRow).toContainElement(screen.getByText("lead"));
    expect(headlineRow).toContainElement(screen.getByText("add"));
  });

  // With the actions moved down, keeping the bar would render an empty 44px
  // strip that pushes the whole screen down for nothing.
  it("omits the compact bar entirely in large mode when there is no back control", () => {
    const { container } = render(() => (
      <NavBar title="Projects" large right={<span>add</span>} />
    ));

    expect(container.querySelector(".tw-navbar__bar")).toBeNull();
  });

  // ...but a back affordance belongs above the title, so the bar comes back
  // for it rather than being dropped along with everything else.
  it("keeps the compact bar in large mode when a back control is given", () => {
    const onClick = vi.fn();
    const { container } = render(() => (
      <NavBar title="Sessions" large back={{ label: "Projects", onClick }} />
    ));

    expect(container.querySelector(".tw-navbar__bar")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Projects/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
