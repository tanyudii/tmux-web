import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "../api/errors";
import { toUiMessage } from "./errorMessage";

describe("toUiMessage", () => {
  it("returns an Error's own message", () => {
    expect(toUiMessage(new UnauthorizedError())).toBe("Token is invalid or expired.");
  });

  it("falls back to a generic message for a non-Error throw", () => {
    expect(toUiMessage("boom")).toBe("Something went wrong.");
    expect(toUiMessage(undefined)).toBe("Something went wrong.");
  });
});
