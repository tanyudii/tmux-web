// Ports presentation/SuspendResult.kt's `deleteHandlingConflict` -- the
// shared delete-then-maybe-force-delete flow used by both Project and
// Session deletion (and session bulk-delete). Generic over the target type
// T (Project | ProjectSession) so every caller shares one implementation
// instead of duplicating the try/catch-409 shape.
import { ConflictError } from "../api/errors";
import { toUiMessage } from "./errorMessage";

export interface ConflictPrompt<T> {
  target: T;
  message: string;
  sessionCount?: number;
}

export type DeleteOutcome<T> =
  | { kind: "deleted" }
  | { kind: "conflict"; prompt: ConflictPrompt<T> }
  | { kind: "error"; message: string };

export async function deleteHandlingConflict<T>(
  target: T,
  del: (force: boolean) => Promise<void>,
): Promise<DeleteOutcome<T>> {
  try {
    await del(false);
    return { kind: "deleted" };
  } catch (error) {
    if (error instanceof ConflictError) {
      return { kind: "conflict", prompt: { target, message: error.message, sessionCount: error.sessionCount } };
    }
    return { kind: "error", message: toUiMessage(error) };
  }
}
