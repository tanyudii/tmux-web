import { join } from "node:path";
import { loadOrCreateSecret } from "./persisted-secret.ts";

// Gates the MCP HTTP transport (see http-server.ts) -- distinct from
// config.ts's main API token and from hook-secret.ts's hook-listener
// token, its own trust boundary again: this is the credential a *remote*
// caller (e.g. an agent on another host reaching in over a VPN) presents
// to invoke send_message at all.
const TOKEN_FILE_NAME = "mcp-token";

export function mcpTokenPath(configDir: string): string {
  return join(configDir, TOKEN_FILE_NAME);
}

export async function loadOrCreateMcpToken(configDir: string): Promise<string> {
  return loadOrCreateSecret(mcpTokenPath(configDir));
}
