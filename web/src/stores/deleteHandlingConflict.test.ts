import { describe, expect, it, vi } from "vitest";
import { ConflictError, ServerError } from "../api/errors";
import { deleteHandlingConflict } from "./deleteHandlingConflict";

describe("deleteHandlingConflict", () => {
  it("resolves deleted when the non-force delete succeeds", async () => {
    const del = vi.fn().mockResolvedValue(undefined);

    const outcome = await deleteHandlingConflict({ id: "1" }, del);

    expect(del).toHaveBeenCalledWith(false);
    expect(outcome).toEqual({ kind: "deleted" });
  });

  it("resolves a conflict prompt carrying the target and sessionCount on a 409", async () => {
    const del = vi.fn().mockRejectedValue(new ConflictError("3 sessions still active", 3));
    const target = { id: "proj-1" };

    const outcome = await deleteHandlingConflict(target, del);

    expect(outcome).toEqual({
      kind: "conflict",
      prompt: { target, message: "3 sessions still active", sessionCount: 3 },
    });
  });

  it("resolves a plain error message for any other failure", async () => {
    const del = vi.fn().mockRejectedValue(new ServerError(500, "boom"));

    const outcome = await deleteHandlingConflict({ id: "1" }, del);

    expect(outcome).toEqual({ kind: "error", message: "boom" });
  });
});
