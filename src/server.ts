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
import {
  WorktreeNotFoundError,
  GitStatusError,
  NothingStagedError,
  type GroupedChanges,
  type FileDiff,
  type DiffMode,
} from "./git-status.ts";
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
  EnvNotStartingError,
  type EnvStatus,
} from "./session-env.ts";
import { EnvConfigError } from "./env-config.ts";
import { EnvEditorError, EnvFileNotFoundError, EnvFileValidationError, type EnvFileEntry } from "./env-editor.ts";
import { PortCollisionError } from "./docker-compose.ts";
import { RateLimiter, type RateLimiterOptions } from "./rate-limit.ts";
import type { PushSubscriptionRecord } from "./push-notifications.ts";
import { TemplateValidationError, TemplateNotFoundError, type SessionTemplate } from "./session-templates.ts";
import { appendAccessLogEntry, type AccessLogEntry } from "./access-log.ts";
import type { SessionEvent } from "./session-events.ts";
import type { SessionResourceUsage } from "./session-env.ts";
import type { SessionMeta } from "./session-meta.ts";

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
  startProjectSessionCreation: (
    project: Project,
    name: string,
    startupCommand?: string,
  ) => Promise<{ name: string; fullName: string }>;
  getProjectSessionCreationStatus: (project: Project, sessionSlug: string) => Promise<SessionCreationStatus>;
  killProjectSession: (
    project: Project,
    sessionSlug: string,
    options: { force?: boolean; deleteBranch?: boolean },
  ) => Promise<void>;
  killProjectSessionSplit: (project: Project, sessionSlug: string) => Promise<void>;
  // EMB-207: read-only pre-check backing the "Delete branch too" checkbox's
  // unmerged-branch warning -- see project-sessions.ts's
  // isProjectSessionBranchMerged.
  isProjectSessionBranchMerged: (project: Project, sessionSlug: string) => Promise<boolean>;
  // Backs the Option-drag copy relay: reads tmux's paste buffer (see
  // tmux.ts's readPasteBuffer) so the browser can write it to the real OS
  // clipboard instead of it staying trapped in tmux's own buffer.
  getProjectSessionPasteBuffer: (project: Project, sessionSlug: string) => Promise<string>;
  // EMB-213: read-only lifecycle event history for a session.
  getProjectSessionEvents: (project: Project, sessionSlug: string) => Promise<SessionEvent[]>;
  // EMB-214: per-session CPU/mem (real docker stats output, cached).
  getProjectSessionResourceUsage: (project: Project, sessionSlug: string) => Promise<SessionResourceUsage>;
  // EMB-222: sets (or clears, when label is undefined and favorite is
  // false) a session's organizational label/favorite flag.
  setProjectSessionMeta: (
    project: Project,
    sessionSlug: string,
    label: string | undefined,
    favorite: boolean,
  ) => Promise<SessionMeta>;

  // EMB-220 session templates.
  listProjectTemplates: (project: Project) => Promise<SessionTemplate[]>;
  createProjectTemplate: (project: Project, name: string, startupCommand?: string) => Promise<SessionTemplate>;
  updateProjectTemplate: (
    project: Project,
    templateId: string,
    name: string,
    startupCommand?: string,
  ) => Promise<SessionTemplate>;
  deleteProjectTemplate: (project: Project, templateId: string) => Promise<void>;

  getProjectSessionChanges: (project: Project, sessionSlug: string) => Promise<GroupedChanges>;
  getProjectSessionDiff: (
    project: Project,
    sessionSlug: string,
    filePath: string,
    mode: DiffMode,
  ) => Promise<FileDiff>;
  stageProjectSessionFile: (project: Project, sessionSlug: string, filePath: string) => Promise<void>;
  unstageProjectSessionFile: (project: Project, sessionSlug: string, filePath: string) => Promise<void>;
  discardProjectSessionFile: (
    project: Project,
    sessionSlug: string,
    filePath: string,
    mode: DiffMode,
  ) => Promise<void>;
  commitProjectSessionChanges: (project: Project, sessionSlug: string, message: string) => Promise<void>;
  listProjectSessionEnvFiles: (project: Project, sessionSlug: string) => Promise<EnvFileEntry[]>;
  readProjectSessionEnvFile: (project: Project, sessionSlug: string, filename: string) => Promise<string>;
  writeProjectSessionEnvFile: (
    project: Project,
    sessionSlug: string,
    filename: string,
    content: string,
  ) => Promise<void>;

  getProjectSessionEnvStatus: (project: Project, sessionSlug: string, requestHost?: string) => Promise<EnvStatus>;
  startProjectSessionEnv: (project: Project, sessionSlug: string) => Promise<void>;
  stopProjectSessionEnv: (project: Project, sessionSlug: string) => Promise<void>;
  cancelProjectSessionEnv: (project: Project, sessionSlug: string) => Promise<void>;

  // Web Push (EMB-212) -- see push-notifications.ts. getPushPublicKey is
  // sync (the VAPID key pair is loaded once at startup, see main.ts).
  getPushPublicKey: () => string;
  subscribePush: (subscription: PushSubscriptionRecord) => Promise<void>;
  unsubscribePush: (endpoint: string) => Promise<void>;
  // Called from the /internal/bell route below, itself driven by the tmux
  // `alert-bell` hook set in setBellHook (tmux.ts) -- NOT part of the public
  // authenticated API surface, see the loopback-only check at its call site.
  notifyBell: (sessionFullName: string) => Promise<void>;

  // EMB-223 access audit log. accessLogPath is optional so tests (and any
  // deployment that doesn't want the file) can omit it -- checkAuthorized
  // simply skips logging when it's undefined. getAccessLog backs the
  // read-only GET /api/access-log route below.
  accessLogPath?: string;
  getAccessLog: () => Promise<AccessLogEntry[]>;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  // Required for WebAssembly.instantiateStreaming() -- the KMP Kotlin/Wasm
  // build's entry point fetches its .wasm binaries directly and needs this
  // exact content type, not the application/octet-stream default.
  ".wasm": "application/wasm",
  // manifest.json (EMB-215) -- served with its registered MIME type rather
  // than falling through to application/octet-stream, which some browsers
  // refuse to accept for the Web App Manifest link.
  ".json": "application/manifest+json",
  ".png": "image/png",
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

// 10 failed auth attempts per minute per IP -- generous for a mistyped
// token retried a few times, tight enough to make brute-forcing the
// 32-byte hex token (see config.ts's generateToken()) computationally
// pointless even before considering the keyspace itself.
const AUTH_FAILURE_LIMIT: RateLimiterOptions = { windowMs: 60_000, max: 10 };

// 30 create-session / env-setup requests per minute per IP. Both spin up
// real resources (git worktree + tmux session, or a docker-compose stack)
// -- generous enough that legitimate multi-tab usage never trips it, tight
// enough to stop a client from hammering the server into resource
// exhaustion.
const EXPENSIVE_ACTION_LIMIT: RateLimiterOptions = { windowMs: 60_000, max: 30 };

function sendTooManyRequests(res: ServerResponse, retryAfterMs: number): void {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  res.writeHead(429, {
    "Content-Type": "application/json; charset=utf-8",
    "Retry-After": String(retryAfterSeconds),
  });
  res.end(JSON.stringify({ error: "Too many requests" }));
}

// Replaces the old bare `isAuthorized` check at every route: still returns
// false (and has already written the response) on a bad/missing token, but
// once a client racks up AUTH_FAILURE_LIMIT failures within the window, the
// (still-failing) attempt gets 429 instead of 401 -- same "not authorized"
// outcome, but with Retry-After so a legitimate client sees it's being
// throttled rather than silently rejected forever. Successful requests are
// never counted, so normal usage never approaches the limit.
//
// EMB-223: also the single choke point every bearer-token-gated request
// passes through, so it's where the access audit log is written --
// fire-and-forget (never awaited, failures swallowed) so a slow/failing
// disk write can never add latency to or block the actual response.
// `accessLogPath` is optional: undefined skips logging entirely, so tests
// that don't care about the audit log don't need to provide one.
function checkAuthorized(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  clientIp: string,
  limiter: RateLimiter,
  accessLogPath: string | undefined,
): boolean {
  const authorized = isAuthorized(req, token);
  if (accessLogPath) {
    void appendAccessLogEntry(accessLogPath, {
      timestamp: new Date().toISOString(),
      ip: clientIp,
      method: req.method ?? "UNKNOWN",
      path: req.url ?? "",
      outcome: authorized ? "authorized" : "denied",
    }).catch(() => {});
  }
  if (authorized) return true;
  const result = limiter.check(clientIp);
  if (result.limited) {
    sendTooManyRequests(res, result.retryAfterMs);
  } else {
    sendEmpty(res, 401);
  }
  return false;
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
  if (error instanceof NothingStagedError) {
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
  if (
    error instanceof EnvAlreadyRunningError ||
    error instanceof EnvNotRunningError ||
    error instanceof EnvNotStartingError ||
    error instanceof PortCollisionError
  ) {
    sendJson(res, 409, { error: error.message });
    return true;
  }
  if (error instanceof EnvConfigError) {
    sendJson(res, 400, { error: error.message });
    return true;
  }
  if (error instanceof EnvFileNotFoundError) {
    sendJson(res, 404, { error: error.message });
    return true;
  }
  if (error instanceof EnvFileValidationError) {
    sendJson(res, 422, { error: error.message });
    return true;
  }
  if (error instanceof EnvEditorError) {
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
  if (error instanceof TemplateValidationError) {
    sendJson(res, 400, { error: error.message });
    return true;
  }
  if (error instanceof TemplateNotFoundError) {
    sendJson(res, 404, { error: error.message });
    return true;
  }
  return false;
}

// /internal/bell (below) is deliberately NOT part of the bearer-token-
// authenticated API -- it's called by a `curl` embedded in a tmux
// `run-shell` hook command (see tmux.ts's setBellHook), which has no way to
// carry this app's own auth token without leaking it into `tmux
// show-hooks`/process-list output visible to anyone with shell access to the
// box. Restricting it to loopback callers only closes that gap: even if
// this server's own host binds 0.0.0.0 (see README/deployment notes), this
// one route only ever accepts requests that originate on the same machine.
function isLoopbackAddress(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

// The wasmJs build's webpack output fingerprints its two big .wasm bundles
// with a content hash as the entire filename (e.g.
// "6e23e5428398b92da386.wasm") -- a new deploy always ships a new filename
// for those, so they're safe to cache forever. Nothing else in the build
// is fingerprinted the same way (composeApp.js, index.html, and vendor/*
// keep fixed names across deploys), so caching those long-term would leave
// a browser serving a stale index.html/JS pair indefinitely after a
// deploy, with no way for it to know a new version exists.
const CONTENT_HASHED_FILENAME = /^[0-9a-f]{16,}\.[^.]+$/i;

function cacheControlFor(filePath: string): string {
  const basename = filePath.slice(filePath.lastIndexOf("/") + 1);
  return CONTENT_HASHED_FILENAME.test(basename) ? "public, max-age=31536000, immutable" : "no-cache";
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
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": cacheControlFor(filePath),
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

export function createServer(deps: ServerDeps): Server {
  const authFailureLimiter = new RateLimiter(AUTH_FAILURE_LIMIT);
  const expensiveActionLimiter = new RateLimiter(EXPENSIVE_ACTION_LIMIT);

  return createHttpServer(async (req, res) => {
    const clientIp = req.socket.remoteAddress ?? "unknown";
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const isTruthy = (value: string | null) => value === "true" || value === "1";

      if (path === "/api/projects" && req.method === "GET") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;
        return sendJson(res, 200, { projects: await deps.listProjects() });
      }

      if (path === "/api/browse" && req.method === "GET") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        try {
          const listing = await deps.browseDirectory(url.searchParams.get("path") ?? undefined);
          return sendJson(res, 200, listing);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      if (path === "/api/projects" && req.method === "POST") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

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
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

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
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

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
        const { name, startupCommand } = body as { name?: unknown; startupCommand?: unknown };
        if (typeof name !== "string") {
          return sendJson(res, 400, { error: "Missing session name" });
        }
        if (startupCommand !== undefined && typeof startupCommand !== "string") {
          return sendJson(res, 400, { error: "startupCommand must be a string" });
        }

        const sessionCreateLimit = expensiveActionLimiter.check(clientIp);
        if (sessionCreateLimit.limited) return sendTooManyRequests(res, sessionCreateLimit.retryAfterMs);

        try {
          const pending = await deps.startProjectSessionCreation(project, name, startupCommand);
          return sendJson(res, 202, { ...pending, phase: "creating" });
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      // EMB-220 session templates.
      const templatesMatch = path.match(/^\/api\/projects\/([^/]+)\/templates$/);
      if (templatesMatch && (req.method === "GET" || req.method === "POST")) {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(templatesMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        if (req.method === "GET") {
          return sendJson(res, 200, { templates: await deps.listProjectTemplates(project) });
        }

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: "Malformed JSON body" });
        }
        const { name: templateName, startupCommand: templateStartupCommand } = body as {
          name?: unknown;
          startupCommand?: unknown;
        };
        if (typeof templateName !== "string") {
          return sendJson(res, 400, { error: "Missing template name" });
        }
        if (templateStartupCommand !== undefined && typeof templateStartupCommand !== "string") {
          return sendJson(res, 400, { error: "startupCommand must be a string" });
        }

        try {
          const template = await deps.createProjectTemplate(project, templateName, templateStartupCommand);
          return sendJson(res, 201, template);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      const templateMatch = path.match(/^\/api\/projects\/([^/]+)\/templates\/([^/]+)$/);
      if (templateMatch && (req.method === "PUT" || req.method === "DELETE")) {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(templateMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });
        const templateId = decodeURIComponent(templateMatch[2]);

        if (req.method === "DELETE") {
          await deps.deleteProjectTemplate(project, templateId);
          return sendEmpty(res, 204);
        }

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: "Malformed JSON body" });
        }
        const { name: templateName, startupCommand: templateStartupCommand } = body as {
          name?: unknown;
          startupCommand?: unknown;
        };
        if (typeof templateName !== "string") {
          return sendJson(res, 400, { error: "Missing template name" });
        }
        if (templateStartupCommand !== undefined && typeof templateStartupCommand !== "string") {
          return sendJson(res, 400, { error: "startupCommand must be a string" });
        }

        try {
          const template = await deps.updateProjectTemplate(project, templateId, templateName, templateStartupCommand);
          return sendJson(res, 200, template);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      const sessionDeleteMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)$/);
      if (sessionDeleteMatch && req.method === "DELETE") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(sessionDeleteMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const sessionSlug = decodeURIComponent(sessionDeleteMatch[2]);
        const force = isTruthy(url.searchParams.get("force"));
        const deleteBranch = isTruthy(url.searchParams.get("deleteBranch"));

        try {
          await deps.killProjectSession(project, sessionSlug, { force, deleteBranch });
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
        return sendEmpty(res, 204);
      }

      // EMB-207: read-only merge check the frontend calls when the user
      // checks "Delete branch too", so an unmerged branch can be flagged
      // with a distinct warning before the (already force-deleting) DELETE
      // request above is ever sent.
      const branchMergedMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/branch-merged$/);
      if (branchMergedMatch && req.method === "GET") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(branchMergedMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const sessionSlug = decodeURIComponent(branchMergedMatch[2]);
        try {
          const merged = await deps.isProjectSessionBranchMerged(project, sessionSlug);
          return sendJson(res, 200, { merged });
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      // Relays tmux's paste buffer (see tmux.ts's readPasteBuffer) after an
      // Option-drag copy-mode selection, so PlatformTerminalView's Cmd+C
      // handler can write it to the real OS clipboard -- see
      // TerminalKeydownHandlers.wasmJs.kt for the client side.
      const pasteBufferMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/paste-buffer$/);
      if (pasteBufferMatch && req.method === "GET") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(pasteBufferMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const sessionSlug = decodeURIComponent(pasteBufferMatch[2]);
        try {
          const text = await deps.getProjectSessionPasteBuffer(project, sessionSlug);
          return sendJson(res, 200, { text });
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      // EMB-213: read-only lifecycle history (created/env setup/env stop/
      // deleted) for a single session.
      const sessionEventsMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/events$/);
      if (sessionEventsMatch && req.method === "GET") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(sessionEventsMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const sessionSlug = decodeURIComponent(sessionEventsMatch[2]);
        const events = await deps.getProjectSessionEvents(project, sessionSlug);
        return sendJson(res, 200, { events });
      }

      // EMB-214: per-session CPU/mem -- `available: false` (not a 404) for
      // sessions that never opted into a docker-compose environment, so the
      // frontend can render "N/A" without treating it as an error.
      const resourceUsageMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/resource-usage$/);
      if (resourceUsageMatch && req.method === "GET") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(resourceUsageMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const sessionSlug = decodeURIComponent(resourceUsageMatch[2]);
        try {
          const usage = await deps.getProjectSessionResourceUsage(project, sessionSlug);
          return sendJson(res, 200, usage);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      // EMB-222: sets a session's organizational label/favorite flag.
      // Whole-resource PUT (not PATCH -- this codebase never uses PATCH,
      // see the template PUT route above) -- the client always sends both
      // fields, mirroring updateProjectTemplate's replace-whole-record
      // shape.
      const sessionMetaMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/meta$/);
      if (sessionMetaMatch && req.method === "PUT") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(sessionMetaMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });
        const sessionSlug = decodeURIComponent(sessionMetaMatch[2]);

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: "Malformed JSON body" });
        }
        const { label, favorite } = body as { label?: unknown; favorite?: unknown };
        if (label !== undefined && typeof label !== "string") {
          return sendJson(res, 400, { error: "label must be a string" });
        }
        if (typeof favorite !== "boolean") {
          return sendJson(res, 400, { error: "favorite must be a boolean" });
        }

        const meta = await deps.setProjectSessionMeta(project, sessionSlug, label, favorite);
        return sendJson(res, 200, meta);
      }

      // EMB-217: tears down the split pane's linked tmux session -- see
      // project-sessions.ts's killProjectSessionSplit. Always 204, even if
      // the split was never opened (nothing to tear down).
      const sessionSplitMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/split$/);
      if (sessionSplitMatch && req.method === "DELETE") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(sessionSplitMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const sessionSlug = decodeURIComponent(sessionSplitMatch[2]);
        await deps.killProjectSessionSplit(project, sessionSlug);
        return sendEmpty(res, 204);
      }

      const creationMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/creation$/);
      if (creationMatch && req.method === "GET") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

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
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

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
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

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

      const stageMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/stage$/);
      if (stageMatch && req.method === "POST") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(stageMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: "Malformed JSON body" });
        }
        const filePath = (body as { path?: unknown })?.path;
        if (typeof filePath !== "string") return sendJson(res, 400, { error: "Missing path" });

        const sessionSlug = decodeURIComponent(stageMatch[2]);
        try {
          await deps.stageProjectSessionFile(project, sessionSlug, filePath);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
        return sendEmpty(res, 204);
      }

      const unstageMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/unstage$/);
      if (unstageMatch && req.method === "POST") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(unstageMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: "Malformed JSON body" });
        }
        const filePath = (body as { path?: unknown })?.path;
        if (typeof filePath !== "string") return sendJson(res, 400, { error: "Missing path" });

        const sessionSlug = decodeURIComponent(unstageMatch[2]);
        try {
          await deps.unstageProjectSessionFile(project, sessionSlug, filePath);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
        return sendEmpty(res, 204);
      }

      const discardMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/discard$/);
      if (discardMatch && req.method === "POST") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(discardMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: "Malformed JSON body" });
        }
        const { path: filePath, mode } = body as { path?: unknown; mode?: unknown };
        if (typeof filePath !== "string") return sendJson(res, 400, { error: "Missing path" });
        if (typeof mode !== "string" || !DIFF_MODES.includes(mode as DiffMode)) {
          return sendJson(res, 400, { error: `Invalid mode, expected one of: ${DIFF_MODES.join(", ")}` });
        }

        const sessionSlug = decodeURIComponent(discardMatch[2]);
        try {
          await deps.discardProjectSessionFile(project, sessionSlug, filePath, mode as DiffMode);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
        return sendEmpty(res, 204);
      }

      const commitMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/commit$/);
      if (commitMatch && req.method === "POST") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(commitMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: "Malformed JSON body" });
        }
        const message = (body as { message?: unknown })?.message;
        if (typeof message !== "string" || message.trim().length === 0) {
          return sendJson(res, 400, { error: "Missing commit message" });
        }

        const sessionSlug = decodeURIComponent(commitMatch[2]);
        try {
          await deps.commitProjectSessionChanges(project, sessionSlug, message);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
        return sendEmpty(res, 204);
      }

      const envFilesMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/env-files$/);
      if (envFilesMatch && req.method === "GET") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(envFilesMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const sessionSlug = decodeURIComponent(envFilesMatch[2]);
        try {
          const files = await deps.listProjectSessionEnvFiles(project, sessionSlug);
          return sendJson(res, 200, { files });
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
      }

      const envFileMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/env-files\/([^/]+)$/);
      if (envFileMatch && (req.method === "GET" || req.method === "PUT")) {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(envFileMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const sessionSlug = decodeURIComponent(envFileMatch[2]);
        const filename = decodeURIComponent(envFileMatch[3]);

        if (req.method === "GET") {
          try {
            const content = await deps.readProjectSessionEnvFile(project, sessionSlug, filename);
            return sendJson(res, 200, { filename, content });
          } catch (error) {
            if (sendMappedError(res, error)) return;
            throw error;
          }
        }

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: "Malformed JSON body" });
        }
        const content = (body as { content?: unknown })?.content;
        if (typeof content !== "string") return sendJson(res, 400, { error: "Missing content" });

        try {
          await deps.writeProjectSessionEnvFile(project, sessionSlug, filename, content);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
        return sendEmpty(res, 204);
      }

      const envCancelMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/env\/cancel$/);
      if (envCancelMatch && req.method === "POST") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        const project = await deps.getProject(decodeURIComponent(envCancelMatch[1]));
        if (!project) return sendJson(res, 404, { error: "Project not found" });

        const sessionSlug = decodeURIComponent(envCancelMatch[2]);
        try {
          await deps.cancelProjectSessionEnv(project, sessionSlug);
        } catch (error) {
          if (sendMappedError(res, error)) return;
          throw error;
        }
        return sendEmpty(res, 204);
      }

      const envMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/env$/);
      if (envMatch && (req.method === "GET" || req.method === "POST" || req.method === "DELETE")) {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

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
          const envSetupLimit = expensiveActionLimiter.check(clientIp);
          if (envSetupLimit.limited) return sendTooManyRequests(res, envSetupLimit.retryAfterMs);

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

      if (path === "/api/push/public-key" && req.method === "GET") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;
        return sendJson(res, 200, { publicKey: deps.getPushPublicKey() });
      }

      if (path === "/api/push/subscribe" && req.method === "POST") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: "Malformed JSON body" });
        }
        const { endpoint, keys } = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
        if (
          typeof endpoint !== "string" ||
          !endpoint ||
          typeof keys?.p256dh !== "string" ||
          typeof keys?.auth !== "string"
        ) {
          return sendJson(res, 400, { error: "Missing endpoint or keys.p256dh/keys.auth" });
        }
        await deps.subscribePush({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
        return sendEmpty(res, 204);
      }

      if (path === "/api/push/unsubscribe" && req.method === "POST") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: "Malformed JSON body" });
        }
        const { endpoint } = body as { endpoint?: unknown };
        if (typeof endpoint !== "string" || !endpoint) {
          return sendJson(res, 400, { error: "Missing endpoint" });
        }
        await deps.unsubscribePush(endpoint);
        return sendEmpty(res, 204);
      }

      // EMB-223: read-only audit trail of who/what accessed this server and
      // when. Bearer-token gated like every other route -- so viewing the
      // log is itself an audited access, same as everything else here.
      if (path === "/api/access-log" && req.method === "GET") {
        if (!checkAuthorized(req, res, deps.token, clientIp, authFailureLimiter, deps.accessLogPath)) return;
        return sendJson(res, 200, { entries: await deps.getAccessLog() });
      }

      // No bearer-token auth by design -- see isLoopbackAddress's comment.
      if (path === "/internal/bell" && req.method === "POST") {
        if (!isLoopbackAddress(clientIp)) return sendJson(res, 404, { error: "Not found" });

        const session = url.searchParams.get("session") ?? "";
        if (!session) return sendJson(res, 400, { error: "Missing session" });

        await deps.notifyBell(session);
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
