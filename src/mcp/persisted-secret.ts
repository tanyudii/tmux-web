import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

// Shared by hook-secret.ts and mcp-token.ts -- both are "generate once,
// persist forever, owner-only permissions" secrets, just for two different
// trust boundaries (the hook-listener's loopback POST vs the MCP HTTP
// transport's bearer auth). Persisted rather than regenerated per process
// start for the same reason config.ts's own token is: something baked into
// installed hook commands / handed to a remote caller must keep working
// across a `tmuxweb mcp` restart.
function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

export async function loadOrCreateSecret(filePath: string): Promise<string> {
  try {
    const existing = (await readFile(filePath, "utf-8")).trim();
    if (existing) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }

  const secret = generateSecret();
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, secret, { mode: 0o600 });
  await rename(tempPath, filePath);
  return secret;
}
