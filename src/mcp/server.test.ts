import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, type McpToolDeps, type SendMessageToolResult } from "./server.ts";

async function withConnectedClient(
  deps: McpToolDeps,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const server = createMcpServer(deps);
  const client = new Client({ name: "test-client", version: "1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

test("lists send_message as an available tool", async () => {
  await withConnectedClient({ sendMessage: async () => ({ status: "result", text: "" }) }, async (client) => {
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === "send_message"));
  });
});

test("send_message forwards its arguments and returns the result as JSON text", async () => {
  const calls: unknown[] = [];
  const result: SendMessageToolResult = { status: "result", text: "task finished" };
  await withConnectedClient(
    {
      sendMessage: async (input) => {
        calls.push(input);
        return result;
      },
    },
    async (client) => {
      const response = await client.callTool({
        name: "send_message",
        arguments: { project: "my-proj", sessionName: "feature-x", message: "do the thing" },
      });

      assert.deepEqual(calls, [{ project: "my-proj", sessionName: "feature-x", message: "do the thing" }]);
      assert.equal(response.isError, undefined);
      const content = response.content as Array<{ type: string; text: string }>;
      assert.deepEqual(JSON.parse(content[0].text), { status: "result", text: "task finished" });
    },
  );
});

test("send_message reports status busy as an error result", async () => {
  await withConnectedClient({ sendMessage: async () => ({ status: "busy" }) }, async (client) => {
    const response = await client.callTool({
      name: "send_message",
      arguments: { project: "p", sessionName: "s", message: "m" },
    });
    assert.equal(response.isError, true);
    const content = response.content as Array<{ type: string; text: string }>;
    assert.match(content[0].text, /still processing/i);
  });
});

test("send_message reports status timeout as an error result", async () => {
  await withConnectedClient({ sendMessage: async () => ({ status: "timeout" }) }, async (client) => {
    const response = await client.callTool({
      name: "send_message",
      arguments: { project: "p", sessionName: "s", message: "m" },
    });
    assert.equal(response.isError, true);
    const content = response.content as Array<{ type: string; text: string }>;
    assert.match(content[0].text, /timed out/i);
  });
});

test("send_message reports status question the same way as result -- both are non-error JSON text", async () => {
  await withConnectedClient(
    { sendMessage: async () => ({ status: "question", text: "should I proceed?" }) },
    async (client) => {
      const response = await client.callTool({
        name: "send_message",
        arguments: { project: "p", sessionName: "s", message: "m" },
      });
      assert.equal(response.isError, undefined);
      const content = response.content as Array<{ type: string; text: string }>;
      assert.deepEqual(JSON.parse(content[0].text), { status: "question", text: "should I proceed?" });
    },
  );
});
