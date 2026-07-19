import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHttpMcpServer } from "./http-server.ts";

const TOKEN = "test-mcp-token";

function makeServer(): McpServer {
  const server = new McpServer({ name: "test", version: "1.0" });
  server.registerTool(
    "echo",
    { description: "echoes input", inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: "text", text }] }),
  );
  return server;
}

async function withHttpServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const httpServer: Server = createHttpMcpServer(makeServer, { expectedToken: TOKEN });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

function mcpInitRequest() {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0" },
      },
    }),
  };
}

test("POST /mcp without a bearer token is rejected with 401", async () => {
  await withHttpServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(res.status, 401);
  });
});

test("POST /mcp with the wrong bearer token is rejected with 401", async () => {
  await withHttpServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(res.status, 401);
  });
});

test("POST /mcp with the correct bearer token is accepted and speaks real MCP JSON-RPC", async () => {
  await withHttpServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/mcp`, mcpInitRequest());
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /"protocolVersion"/);
  });
});

test("two independent, sequential requests against the same running server both succeed -- regression test: an earlier version shared one transport across the whole process lifetime and 500'd on the second request", async () => {
  await withHttpServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/mcp`, mcpInitRequest());
    assert.equal(first.status, 200);

    const second = await fetch(`${baseUrl}/mcp`, mcpInitRequest());
    assert.equal(second.status, 200);
    const body = await second.text();
    assert.match(body, /"protocolVersion"/);
  });
});

test("an unknown path returns 404", async () => {
  await withHttpServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/whatever`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 404);
  });
});
