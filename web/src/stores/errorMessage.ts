// Ports presentation/SuspendResult.kt's `Throwable.toUiMessage()`. Every
// ApiError subclass (api/errors.ts) already carries a user-presentable
// `.message` set in its own constructor, so this only needs a safe
// fallback for anything that isn't one of ours (a thrown string, a
// non-Error value, etc.).
export function toUiMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
