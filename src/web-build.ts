import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Returns `dir` if it looks like a real KMP wasmJs build output (contains
 * index.html), otherwise undefined -- so the server just skips static
 * serving (API-only, matching today's default) instead of crashing when the
 * Web build hasn't been run yet. See src/server.ts's `publicDir`/serveStatic.
 */
export function resolveWebBuildDir(dir: string): string | undefined {
  return existsSync(join(dir, "index.html")) ? dir : undefined;
}
