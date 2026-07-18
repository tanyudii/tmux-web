import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpTokenPath, loadOrCreateMcpToken } from "./mcp-token.ts";

test("mcpTokenPath is a distinct file from hook-secret.ts's path, under the given configDir", () => {
  assert.equal(mcpTokenPath("/home/user/.tmux-web"), "/home/user/.tmux-web/mcp-token");
});

test("loadOrCreateMcpToken generates and then persists a stable token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-mcp-token-"));
  try {
    const first = await loadOrCreateMcpToken(dir);
    const second = await loadOrCreateMcpToken(dir);
    assert.equal(first, second);
    assert.ok(first.length >= 32);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
