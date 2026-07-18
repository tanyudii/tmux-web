import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extractBearerToken, verifyToken } from "../auth.ts";

export interface HookEventPayload {
  hookEvent: "Stop" | "Notification";
  text: string;
}

export interface HookListenerDeps {
  onHookEvent: (session: string, event: HookEventPayload) => void;
  // Compared (constant-time, via auth.ts's verifyToken) against the POST's
  // Authorization header. Loopback-only is NOT sufficient on its own here,
  // unlike server.ts's /internal/bell: a forged /hook POST doesn't just
  // trigger a cosmetic notification, it resolves a real send_message wait
  // with attacker-supplied text, which becomes the trusted result/question
  // handed back to whatever external agent called send_message. Any local
  // process being able to spoof that would defeat the whole point of the
  // tool. The secret is generated once per install (hook-secret.ts) and
  // baked into each hook command at session-creation time (mcp-command.ts),
  // so only a hook-script.ts this same tmux-web install actually installed
  // can produce a valid header.
  expectedSecret: string;
}

// Loopback-only remains a first layer (closing the same "even if tmux-web
// itself is bound to a non-loopback interface" gap /internal/bell closes),
// but the real authorization boundary is the shared secret above.
function isLoopbackAddress(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function isHookEvent(value: string): value is HookEventPayload["hookEvent"] {
  return value === "Stop" || value === "Notification";
}

export function createHookListener(deps: HookListenerDeps): Server {
  return createHttpServer(async (req, res) => {
    const clientIp = req.socket.remoteAddress ?? "unknown";
    if (!isLoopbackAddress(clientIp)) return sendJson(res, 404, { error: "Not found" });

    if (req.url !== "/hook" || req.method !== "POST") {
      return sendJson(res, 404, { error: "Not found" });
    }

    if (!verifyToken(extractBearerToken(req.headers.authorization), deps.expectedSecret)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON body" });
    }

    const { session, hookEvent, text } = (body ?? {}) as Record<string, unknown>;
    if (typeof session !== "string" || session.length === 0) {
      return sendJson(res, 400, { error: "Missing session" });
    }
    if (typeof hookEvent !== "string" || !isHookEvent(hookEvent)) {
      return sendJson(res, 400, { error: "Invalid hookEvent" });
    }

    deps.onHookEvent(session, { hookEvent, text: typeof text === "string" ? text : "" });
    return sendEmpty(res, 204);
  });
}
