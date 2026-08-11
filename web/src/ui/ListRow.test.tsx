import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListRow } from "./ListRow";

describe("ListRow", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders as a non-interactive element (no button role) when onClick is omitted", () => {
    render(() => <ListRow title="my-project" />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("my-project")).toBeInTheDocument();
  });

  it("renders as a real button and fires onClick when given", () => {
    const onClick = vi.fn();
    render(() => <ListRow title="my-project" onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: /my-project/ }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders subtitle and meta lines when given", () => {
    render(() => <ListRow title="my-project" subtitle="/home/user/my-project" meta="3 sessions" />);

    expect(screen.getByText("/home/user/my-project")).toBeInTheDocument();
    expect(screen.getByText("3 sessions")).toBeInTheDocument();
  });

  it("shows the auto-chevron by default when interactive, and hides it when chevron=false", () => {
    const { container, unmount } = render(() => <ListRow title="a" onClick={vi.fn()} />);
    expect(container.querySelector(".tw-list-row__chevron")).not.toBeNull();
    unmount();

    const { container: container2 } = render(() => <ListRow title="a" onClick={vi.fn()} chevron={false} />);
    expect(container2.querySelector(".tw-list-row__chevron")).toBeNull();
  });

  it("never shows the chevron on a non-interactive row even if chevron is not set to false", () => {
    const { container } = render(() => <ListRow title="a" />);

    expect(container.querySelector(".tw-list-row__chevron")).toBeNull();
  });

  it("marks the row active via data-active", () => {
    render(() => <ListRow title="a" active onClick={vi.fn()} />);

    expect(screen.getByRole("button", { name: /a/ }).getAttribute("data-active")).toBe("true");
  });
});
