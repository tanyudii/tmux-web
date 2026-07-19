import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { extractBearerToken, verifyToken } from "../auth.ts";

export interface HttpMcpServerOptions {
  expectedToken: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : undefined;
}

// Exposes an McpServer over the MCP Streamable HTTP transport
// (StreamableHTTPServerTransport, part of the core @modelcontextprotocol/sdk
// package -- no extra dependency beyond what that package already pulls in
// for itself), so a remote caller (e.g. an agent on another host reaching
// in over a VPN) can invoke its tools the same way a local stdio client
// would. Bearer-token gated, same shape as this app's main HTTP API
// (auth.ts) but with its own token (mcp-token.ts) -- unlike stdio, where
// "can spawn a local process" is implicitly the trust boundary, an HTTP
// endpoint reachable over a network needs an explicit credential, since
// anything on that network segment could otherwise call send_message and
// make Claude Code execute arbitrary instructions.
//
// Takes a *factory* (`() => McpServer`), not a pre-built instance, and
// constructs a fresh McpServer + fresh StreamableHTTPServerTransport for
// EVERY request rather than sharing one long-lived transport across the
// server's whole uptime. This mirrors the SDK's own documented stateless
// pattern (sessionIdGenerator: undefined + a new transport per request) --
// confirmed live that reusing a single transport instance works for exactly
// one request and then 500s on the next: the transport/low-level Server
// pairing carries protocol-level state (e.g. the initialize handshake) that
// isn't safe to reuse across independent requests in stateless mode.
// createMcpServer() itself is cheap (one tool registration), so rebuilding
// it per request costs nothing meaningful; the actual tool logic
// (send_message's closure over pending-tasks.ts's store) is unaffected
// since that's captured once by the factory's own closure, not rebuilt.
export function createHttpMcpServer(createServerInstance: () => McpServer, options: HttpMcpServerOptions): Server {
  return createHttpServer(async (req, res) => {
    if (req.url !== "/mcp") {
      return sendJson(res, 404, { error: "Not found" });
    }

    if (!verifyToken(extractBearerToken(req.headers.authorization), options.expectedToken)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    let parsedBody: unknown;
    if (req.method === "POST") {
      try {
        parsedBody = await readJsonBody(req);
      } catch {
        return sendJson(res, 400, { error: "Invalid JSON body" });
      }
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
    });
    await createServerInstance().connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  });
}
