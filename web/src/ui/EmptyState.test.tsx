import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the title and subtitle", () => {
    render(() => <EmptyState title="No projects yet" subtitle="Add one to get started" />);

    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("Add one to get started")).toBeInTheDocument();
  });

  it("renders the icon slot when given", () => {
    render(() => <EmptyState title="No projects yet" subtitle="Add one" icon={<span>folder-icon</span>} />);

    expect(screen.getByText("folder-icon")).toBeInTheDocument();
  });

  it("omits the icon wrapper when no icon is given", () => {
    const { container } = render(() => <EmptyState title="No projects yet" subtitle="Add one" />);

    expect(container.querySelector(".tw-empty-state__icon")).toBeNull();
  });
});
