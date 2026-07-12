import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { extractBearerToken, verifyToken } from "./auth.ts";
import { ValidationError, type TmuxSession } from "./tmux.ts";

export interface ServerDeps {
  token: string;
  listSessions: () => Promise<TmuxSession[]>;
  createSession: (name: string) => Promise<void>;
  killSession: (name: string) => Promise<void>;
  publicDir?: string;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

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

function isAuthorized(req: IncomingMessage, token: string): boolean {
  return verifyToken(extractBearerToken(req.headers.authorization), token);
}

async function serveStatic(publicDir: string, urlPath: string, res: ServerResponse): Promise<boolean> {
  const relativePath = urlPath === "/" ? "/index.html" : urlPath;
  // Strip any leading ../ segments so a crafted path can't escape publicDir.
  const safeRelative = normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safeRelative);
  if (!filePath.startsWith(publicDir)) return false;

  try {
    const data = await readFile(filePath);
    const ext = filePath.slice(filePath.lastIndexOf("."));
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

export function createServer(deps: ServerDeps): Server {
  return createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      if (path === "/api/sessions" && req.method === "GET") {
        if (!isAuthorized(req, deps.token)) return sendEmpty(res, 401);
        return sendJson(res, 200, { sessions: await deps.listSessions() });
      }

      if (path === "/api/sessions" && req.method === "POST") {
        if (!isAuthorized(req, deps.token)) return sendEmpty(res, 401);

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: "Malformed JSON body" });
        }

        const name = (body as { name?: unknown })?.name;
        if (typeof name !== "string") {
          return sendJson(res, 400, { error: "Missing session name" });
        }

        try {
          await deps.createSession(name);
        } catch (error) {
          if (error instanceof ValidationError) return sendJson(res, 400, { error: error.message });
          throw error;
        }
        return sendJson(res, 201, { name });
      }

      const deleteMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
      if (deleteMatch && req.method === "DELETE") {
        if (!isAuthorized(req, deps.token)) return sendEmpty(res, 401);

        try {
          await deps.killSession(decodeURIComponent(deleteMatch[1]));
        } catch (error) {
          if (error instanceof ValidationError) return sendJson(res, 400, { error: error.message });
          throw error;
        }
        return sendEmpty(res, 204);
      }

      if (deps.publicDir && req.method === "GET") {
        if (await serveStatic(deps.publicDir, path, res)) return;
      }

      return sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Internal error" });
    }
  });
}
