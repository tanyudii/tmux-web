import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { extractBearerToken, verifyToken } from "./auth.ts";
import { ValidationError } from "./tmux.ts";
import { ProjectValidationError, type Project } from "./projects.ts";
import {
  InvalidDirectoryPathError,
  DirectoryNotFoundError,
  DirectoryAccessDeniedError,
  NotADirectoryError,
  type DirectoryListing,
} from "./directory-browser.ts";
import { WorktreeConflictError, DirtyWorktreeError } from "./worktree.ts";
import { WorktreeNotFoundError, GitStatusError, type GroupedChanges, type FileDiff, type DiffMode } from "./git-status.ts";
import {
  SessionCreationInProgressError,
  SessionCreationNotFoundError,
  type ProjectSession,
  type SessionCreationStatus,
} from "./project-sessions.ts";
import {
  EnvUnavailableError,
  EnvAlreadyRunningError,
  EnvNotRunningError,
  type EnvStatus,
} from "./session-env.ts";
import { EnvConfigError } from "./env-config.ts";

const DIFF_MODES: readonly DiffMode[] = ["staged", "unstaged", "untracked"];

export interface ServerDeps {
  token: string;
  publicDir?: string;

  listProjects: () => Promise<Project[]>;
  registerProject: (name: string, repoPath: string) => Promise<Project>;
  getProject: (id: string) => Promise<Project | undefined>;
  removeProject: (id: string) => Promise<void>;
  browseDirectory: (path: string | undefined) => Promise<DirectoryListing>;

  listProjectSessions: (project: Project) => Promise<ProjectSession[]>;
  startProjectSessionCreation: (project: Project, name: string) => Promise<{ name: string; fullName: string }>;
  getProjectSessionCreationStatus: (project: Project, sessionSlug: string) => Promise<SessionCreationStatus>;
  killProjectSession: (
    project: Project,
    sessionSlug: string,
    options: { force?: boolean },
  ) => Promise<void>;

  getProjectSessionChanges: (project: Project, sessionSlug: string) => Promise<GroupedChanges>;
  getProjectSessionDiff: (
    project: Project,
    sessionSlug: string,
    filePath: string,
    mode: DiffMode,
  ) => Promise<FileDiff>;

  getProjectSessionEnvStatus: (project: Project, sessionSlug: string, requestHost?: string) => Promise<EnvStatus>;
  startProjectSessionEnv: (project: Project, sessionSlug: string) => Promise<void>;
  stopProjectSessionEnv: (project: Project, sessionSlug: string) => Promise<void>;
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

// Derives the "Open" URL's host from whatever address the browser is
// CURRENTLY using to reach tmux-web itself (127.0.0.1, a LAN IP, a VPN IP,
// ...), read straight off the request's Host header -- so the generated
// session URL always matches, instead of a hardcoded "localhost" that only
// works when tmux-web and the browser are on the very same machine. Wrapped
// in a URL parse (not a manual split) so IPv6 literals like "[::1]:5309"
// aren't mangled by naively splitting on ":".
function extractRequestHost(req: IncomingMessage): string | undefined {
  const hostHeader = req.headers.host;
  if (!hostHeader) return undefined;
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return undefined;
  }
}

// Maps errors from the project/session/worktree layers onto HTTP status
// codes. Anything not recognized here falls through to the outer 500
// handler in createServer.
function sendMappedError(res: ServerResponse, error: unknown): boolean {
  if (error instanceof ProjectValidationError || error instanceof ValidationError) {
    sendJson(res, 400, { error: error.message });
    return true;
  }
  if (error instanceof WorktreeConflictError || error instanceof DirtyWorktreeError) {
    sendJson(res, 409, { error: error.message });
    return true;
  }
  if (error instanceof GitStatusError) {
    sendJson(res, 400, { error: error.message });
    return true;
  }
  if (error instanceof WorktreeNotFoundError || error instanceof EnvUnavailableError) {
    sendJson(res, 404, { error: error.message });
    return true;
  }
  if (error instanceof EnvAlreadyRunningError || error instanceof EnvNotRunningError) {
    sendJson(res, 409, { error: error.message });
    return true;
  }
  if (error instanceof EnvConfigError) {
    sendJson(res, 400, { error: error.message });
    return true;
  }
  if (error instanceof SessionCreationInProgressError) {
    sendJson(res, 409, { error: error.message });
    return true;
  }
  if (error instanceof SessionCreationNotFoundError) {
    sendJson(res, 404, { error: error.message });
    return true;
  }
  if (error instanceof InvalidDirectoryPathError || error instanceof NotADirectoryError) {
    sendJson(res, 400, { error: error.message });
    return true;
  }
  if (error instanceof DirectoryNotFoundError) {
    sendJson(res, 404, { error: error.message });
    return true;
  }
  if (error instanceof DirectoryAccessDeniedError) {
    sendJson(res, 403, { error: error.message });
    return true;
  }
  return false;
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
      const isTruthy = (value: string | null) => value === "true" || value === "1";

      if (path === "/api/projects" && req.method === "GET") {
        if (!isAuthorized(req, deps.token)) return sendEmpty(res, 401);
        return sendJson(res, 200, { projects: await deps.listProjects() });
      }

      if (path === "/api/browse" && req.method === "GET") {
        if (!isAuthorized(req, deps.token)) return sendEmpty(res, 401);

        try {
          const listing = await deps.browseDirectory(url.searchParams.get("path") ?? undefined);
          return sendJson(res, 200, listing);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      if (path === "/api/projects" && req.method === "POST") {
        if (!isAuthorized(req, deps.token)) return sendEmpty(res, 401);

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: "Malformed JSON body" });
        }
        const { name, repoPath } = body as { name?: unknown; repoPath?: unknown };
        if (typeof name !== "string" || typeof repoPath !== "string") {
          return sendJson(res, 400, { error: "Missing name or repoPath" });
        }

        try {
          const project = await deps.registerProject(name, repoPath);
          return sendJson(res, 201, project);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      const projectIdMatch = path.match(/^\/api\/projects\/([^/]+)$/);
      if (projectIdMatch && req.method === "DELETE") {
        if (!isAuthorized(req, deps.token)) return sendEmpty(res, 401);

        const project = await deps.getProject(decodeURIComponent(projectIdMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const force = isTruthy(url.searchParams.get("force"));
        if (!force) {
          const sessions = await deps.listProjectSessions(project);
          if (sessions.length > 0) {
            return sendJson(res, 409, { error: "Project has active sessions", sessionCount: sessions.length });
          }
        }

        await deps.removeProject(project.id);
        return sendEmpty(res, 204);
      }

      const sessionsMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions$/);
      if (sessionsMatch && (req.method === "GET" || req.method === "POST")) {
        if (!isAuthorized(req, deps.token)) return sendEmpty(res, 401);

        const project = await deps.getProject(decodeURIComponent(sessionsMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        if (req.method === "GET") {
          return sendJson(res, 200, { sessions: await deps.listProjectSessions(project) });
        }

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
          const pending = await deps.startProjectSessionCreation(project, name);
          return sendJson(res, 202, { ...pending, phase: "creating" });
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      const sessionDeleteMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)$/);
      if (sessionDeleteMatch && req.method === "DELETE") {
        if (!isAuthorized(req, deps.token)) return sendEmpty(res, 401);

        const project = await deps.getProject(decodeURIComponent(sessionDeleteMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const sessionSlug = decodeURIComponent(sessionDeleteMatch[2]);
        const force = isTruthy(url.searchParams.get("force"));

        try {
          await deps.killProjectSession(project, sessionSlug, { force });
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
        return sendEmpty(res, 204);
      }

      const creationMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/creation$/);
      if (creationMatch && req.method === "GET") {
        if (!isAuthorized(req, deps.token)) return sendEmpty(res, 401);

        const project = await deps.getProject(decodeURIComponent(creationMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const sessionSlug = decodeURIComponent(creationMatch[2]);

        try {
          const status = await deps.getProjectSessionCreationStatus(project, sessionSlug);
          return sendJson(res, 200, status);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      const changesMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/changes$/);
      if (changesMatch && req.method === "GET") {
        if (!isAuthorized(req, deps.token)) return sendEmpty(res, 401);

        const project = await deps.getProject(decodeURIComponent(changesMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const sessionSlug = decodeURIComponent(changesMatch[2]);
        try {
          const changes = await deps.getProjectSessionChanges(project, sessionSlug);
          return sendJson(res, 200, changes);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      const diffMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/diff$/);
      if (diffMatch && req.method === "GET") {
        if (!isAuthorized(req, deps.token)) return sendEmpty(res, 401);

        const project = await deps.getProject(decodeURIComponent(diffMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const filePath = url.searchParams.get("path");
        if (!filePath) return sendJson(res, 400, { error: "Missing path query parameter" });

        const mode = url.searchParams.get("mode");
        if (!mode || !DIFF_MODES.includes(mode as DiffMode)) {
          return sendJson(res, 400, { error: `Invalid mode, expected one of: ${DIFF_MODES.join(", ")}` });
        }

        const sessionSlug = decodeURIComponent(diffMatch[2]);
        try {
          const diff = await deps.getProjectSessionDiff(project, sessionSlug, filePath, mode as DiffMode);
          return sendJson(res, 200, diff);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      const envMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/env$/);
      if (envMatch && (req.method === "GET" || req.method === "POST" || req.method === "DELETE")) {
        if (!isAuthorized(req, deps.token)) return sendEmpty(res, 401);

        const project = await deps.getProject(decodeURIComponent(envMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const sessionSlug = decodeURIComponent(envMatch[2]);

        if (req.method === "GET") {
          try {
            const status = await deps.getProjectSessionEnvStatus(project, sessionSlug, extractRequestHost(req));
            return sendJson(res, 200, status);
          } catch (error) {
            if (sendMappedError(res, error)) return;
            throw error;
          }
        }

        if (req.method === "POST") {
          try {
            // startProjectSessionEnv only awaits the fast eligibility
            // checks -- the actual docker-compose setup keeps running in
            // the background, observed by polling GET .../env.
            await deps.startProjectSessionEnv(project, sessionSlug);
          } catch (error) {
            if (sendMappedError(res, error)) return;
            throw error;
          }
          return sendEmpty(res, 202);
        }

        try {
          await deps.stopProjectSessionEnv(project, sessionSlug);
        } catch (error) {
          if (sendMappedError(res, error)) return;
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
