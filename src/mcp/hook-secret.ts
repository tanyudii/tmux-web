import { join } from "node:path";
import { loadOrCreateSecret } from "./persisted-secret.ts";

// Separate from config.ts's main bearer token by design -- that token gates
// the browser-facing HTTP API, this one gates hook-listener.ts's /hook
// endpoint, a different trust boundary (see hook-listener.ts's comment).
// Also separate from mcp-token.ts's token, which gates the MCP HTTP
// transport itself (see http-server.ts) -- a third, distinct trust
// boundary again. Persisted (not regenerated per `tmuxweb mcp` invocation)
// because it gets baked into hook commands installed into worktrees'
// settings.local.json at session-creation time -- a session created by one
// `tmuxweb mcp` process must still authenticate correctly against a later
// restart of that process.
const SECRET_FILE_NAME = "mcp-hook-secret";

export function hookSecretPath(configDir: string): string {
  return join(configDir, SECRET_FILE_NAME);
}

export async function loadOrCreateHookSecret(configDir: string): Promise<string> {
  return loadOrCreateSecret(hookSecretPath(configDir));
}
