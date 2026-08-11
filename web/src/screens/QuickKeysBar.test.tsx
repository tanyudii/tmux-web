import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickKeysBar } from "./QuickKeysBar";

describe("QuickKeysBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders all five quick keys and sends the right raw sequence for each", () => {
    const onKeyTap = vi.fn();
    render(() => <QuickKeysBar onKeyTap={onKeyTap} />);

    fireEvent.click(screen.getByRole("button", { name: "Esc" }));
    fireEvent.click(screen.getByRole("button", { name: "Tab" }));
    fireEvent.click(screen.getByRole("button", { name: "^C" }));
    fireEvent.click(screen.getByRole("button", { name: "^B" }));
    fireEvent.click(screen.getByRole("button", { name: "^D" }));

    expect(onKeyTap).toHaveBeenNthCalledWith(1, "\x1b");
    expect(onKeyTap).toHaveBeenNthCalledWith(2, "\t");
    expect(onKeyTap).toHaveBeenNthCalledWith(3, "\x03");
    expect(onKeyTap).toHaveBeenNthCalledWith(4, "\x02");
    expect(onKeyTap).toHaveBeenNthCalledWith(5, "\x04");
  });
});
