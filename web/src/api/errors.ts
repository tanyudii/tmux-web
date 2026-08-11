// Mirrors ApiError.kt's sealed class -- the same error taxonomy
// `sendMappedError` (src/server.ts) maps HTTP status codes to, so the UI
// layer can branch on error type instead of parsing status codes itself.
import { z } from "zod";

const apiErrorBodySchema = z.object({
  error: z.string(),
  sessionCount: z.number().optional(),
});

export class UnauthorizedError extends Error {
  constructor() {
    super("Token is invalid or expired.");
    this.name = "UnauthorizedError";
  }
}

export class NotFoundError extends Error {
  constructor(public readonly serverMessage: string) {
    super(serverMessage);
    this.name = "NotFoundError";
  }
}

export class BadRequestError extends Error {
  constructor(public readonly serverMessage: string) {
    super(serverMessage);
    this.name = "BadRequestError";
  }
}

// 409 -- e.g. a session's worktree has uncommitted changes and the caller
// must confirm force-delete, or a project still has active sessions.
export class ConflictError extends Error {
  constructor(
    public readonly serverMessage: string,
    public readonly sessionCount?: number,
  ) {
    super(serverMessage);
    this.name = "ConflictError";
  }
}

export class ServerError extends Error {
  constructor(
    public readonly status: number,
    public readonly serverMessage: string,
  ) {
    super(serverMessage);
    this.name = "ServerError";
  }
}

export class TransportError extends Error {
  constructor(public readonly cause: unknown) {
    super(`Could not reach the server: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "TransportError";
  }
}

export class DecodingError extends Error {
  constructor(public readonly cause: unknown) {
    super("Server response did not match the expected format.");
    this.name = "DecodingError";
  }
}

export type ApiError =
  | UnauthorizedError
  | NotFoundError
  | BadRequestError
  | ConflictError
  | ServerError
  | TransportError
  | DecodingError;

// Reads a non-2xx Response's body (best-effort, falling back to the raw
// text when it isn't the `{error, sessionCount?}` JSON shape the backend
// documents) and maps it to the matching ApiError subclass.
export async function mapErrorResponse(response: Response): Promise<ApiError> {
  const bodyText = await response.text().catch(() => "");
  const parsed = apiErrorBodySchema.safeParse(safeJsonParse(bodyText));
  const message = parsed.success ? parsed.data.error : bodyText;

  switch (response.status) {
    case 401:
      return new UnauthorizedError();
    case 404:
      return new NotFoundError(message);
    case 400:
      return new BadRequestError(message);
    case 409:
      return new ConflictError(message, parsed.success ? parsed.data.sessionCount : undefined);
    default:
      return new ServerError(response.status, message);
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
