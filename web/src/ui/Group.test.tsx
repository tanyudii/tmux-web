import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { Group, GroupDivider } from "./Group";

describe("Group", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders header, children, and footer", () => {
    render(() => (
      <Group header="Sessions" footer="Pull to refresh">
        <p>row content</p>
      </Group>
    ));

    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("row content")).toBeInTheDocument();
    expect(screen.getByText("Pull to refresh")).toBeInTheDocument();
  });

  it("omits header/footer elements when not given", () => {
    const { container } = render(() => (
      <Group>
        <p>row content</p>
      </Group>
    ));

    expect(container.querySelector(".tw-group__header")).toBeNull();
    expect(container.querySelector(".tw-group__footer")).toBeNull();
  });
});

describe("GroupDivider", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders as a separator", () => {
    render(() => <GroupDivider />);

    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});
