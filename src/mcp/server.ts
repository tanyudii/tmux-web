import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export type SendMessageToolResult =
  | { status: "result" | "question"; text: string }
  | { status: "busy" }
  | { status: "timeout" };

export interface McpToolDeps {
  sendMessage: (input: { project: string; sessionName: string; message: string }) => Promise<SendMessageToolResult>;
}

const SERVER_NAME = "tmux-web";
const SERVER_VERSION = "1.0.0";

const SEND_MESSAGE_DESCRIPTION =
  "Send a message into a persistent, interactive Claude Code session running inside a tmux-web project worktree, " +
  "creating the session on first use. Waits for Claude to either finish the turn (status \"result\") or ask a " +
  "question / request permission (status \"question\") before returning. Never uses `claude -p` -- every call " +
  "types into the same living REPL exactly like a human would, so conversation context is never reset between calls. " +
  "Reuse the same sessionName to continue the same conversation; a session already mid-turn returns status \"busy\".";

export function createMcpServer(deps: McpToolDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "send_message",
    {
      description: SEND_MESSAGE_DESCRIPTION,
      inputSchema: {
        project: z.string().describe("tmux-web project name or id"),
        sessionName: z.string().describe("Session name -- reuse it to continue the same conversation"),
        message: z.string().describe("The message to type into the Claude Code session"),
      },
    },
    async ({ project, sessionName, message }) => {
      const result = await deps.sendMessage({ project, sessionName, message });

      if (result.status === "busy") {
        return {
          isError: true,
          content: [
            { type: "text", text: `Session "${sessionName}" is still processing a previous message -- try again shortly.` },
          ],
        };
      }
      if (result.status === "timeout") {
        return {
          isError: true,
          content: [{ type: "text", text: `Timed out waiting for a response from session "${sessionName}".` }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ status: result.status, text: result.text }) }],
      };
    },
  );

  return server;
}

export async function startMcpServer(deps: McpToolDeps): Promise<void> {
  const server = createMcpServer(deps);
  await server.connect(new StdioServerTransport());
}
