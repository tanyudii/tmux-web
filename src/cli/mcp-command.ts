import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { defaultConfigDir } from "../config.ts";
import { loadProjects, type Project } from "../projects.ts";
import { defaultWorktreesRoot, resolveWorktreePath, addWorktree, removeWorktree } from "../worktree.ts";
import { buildSessionName } from "../session-naming.ts";
import { slugifyBranchName } from "../slug.ts";
import {
  createSession as tmuxCreateSession,
  killSession,
  sendKeysToSession,
  capturePane,
  isValidSessionName,
  ValidationError,
} from "../tmux.ts";
import { createPendingTaskStore, resolveHookEvent } from "../mcp/pending-tasks.ts";
import { createHookListener } from "../mcp/hook-listener.ts";
import { ensureSessionHooks } from "../mcp/hook-config-merge.ts";
import { loadOrCreateHookSecret } from "../mcp/hook-secret.ts";
import { loadOrCreateMcpToken } from "../mcp/mcp-token.ts";
import { sendMessage as sendMessageCore } from "../mcp/send-message.ts";
import { createMcpServer, type McpToolDeps } from "../mcp/server.ts";
import { createHttpMcpServer } from "../mcp/http-server.ts";

const execFileAsync = promisify(execFileCb);

export class McpCommandError extends Error {}

// Distinct from config.ts's DEFAULT_PORT (5309, the main HTTP API) -- this
// listener only ever talks to hook-script.ts on the same machine, never to
// a browser, so it doesn't share the main server's port or auth model.
const DEFAULT_HOOK_PORT = 5310;

// Distinct again from both of the above -- the optional --http mode's own
// port, for a *remote* MCP client (e.g. an agent on another host over a
// VPN) rather than a local subprocess (stdio, the default) or a local hook
// script (DEFAULT_HOOK_PORT).
const DEFAULT_HTTP_PORT = 5311;
const DEFAULT_HTTP_HOST = "127.0.0.1";

// Generous: a Claude Code turn can involve several tool calls of its own
// (builds, test runs, web fetches) before it reaches a Stop/Notification --
// long enough that a real, non-trivial task doesn't spuriously time out,
// short enough that a genuinely stuck session is reported back to the
// caller rather than hanging indefinitely.
const DEFAULT_WAIT_TIMEOUT_MS = 20 * 60 * 1000;

export interface McpCommandDeps {
  configDir?: string;
  worktreesRoot?: string;
  hookPort?: number;
  waitTimeoutMs?: number;
}

export interface McpCliOptions {
  http: boolean;
  host: string;
  port: number;
}

// `tmuxweb mcp` (default): stdio, for a client that spawns this as a local
// subprocess on the same machine.
// `tmuxweb mcp --http [--host <addr>] [--port <n>]`: Streamable HTTP, for a
// remote client (e.g. an agent on another host) reaching in over a network
// -- typically a private VPN interface (WireGuard/Tailscale), same
// deployment model this app's main HTTP API already documents. --host
// defaults to loopback-only (127.0.0.1) same as the hook listener; an
// operator who wants this reachable from another host must opt in
// explicitly with --host, mirroring `tmuxweb config host` for the main API.
export function parseMcpArgs(args: string[]): McpCliOptions {
  const http = args.includes("--http");
  const hostIndex = args.indexOf("--host");
  const portIndex = args.indexOf("--port");
  const host = hostIndex >= 0 ? args[hostIndex + 1] : undefined;
  const portRaw = portIndex >= 0 ? args[portIndex + 1] : undefined;

  if (hostIndex >= 0 && !host) {
    throw new McpCommandError("Usage: tmuxweb mcp [--http] [--host <addr>] [--port <n>]");
  }
  if (portIndex >= 0 && !portRaw) {
    throw new McpCommandError("Usage: tmuxweb mcp [--http] [--host <addr>] [--port <n>]");
  }

  const port = portRaw !== undefined ? Number.parseInt(portRaw, 10) : DEFAULT_HTTP_PORT;
  if (Number.isNaN(port)) {
    throw new McpCommandError(`Invalid --port value: "${portRaw}"`);
  }

  return { http, host: host ?? DEFAULT_HTTP_HOST, port };
}

export function resolveProject(projects: Project[], identifier: string): Project {
  const matched = projects.find((project) => project.id === identifier || project.name === identifier);
  if (!matched) {
    throw new McpCommandError(`Unknown tmux-web project: "${identifier}"`);
  }
  return matched;
}

export function resolveSessionSlug(sessionName: string): string {
  const slug = slugifyBranchName(sessionName);
  if (!slug) {
    throw new McpCommandError(`Session name has no usable characters: "${sessionName}"`);
  }
  return slug;
}

export function hookScriptPath(): string {
  return fileURLToPath(new URL("../mcp/hook-script.ts", import.meta.url));
}

// No secret is embedded in this command string -- hook-script.ts reads the
// shared secret itself, at hook-fire time, from hook-secret.ts's 0600 file
// under configDir. That keeps the secret out of both argv (visible to any
// local user via `ps`/`/proc/<pid>/cmdline`) and out of the
// settings.local.json file this command string gets written into.
export function buildHookCommand(
  execPathNode: string,
  scriptPath: string,
  fullSessionName: string,
  hookPort: number,
  configDir: string,
): string {
  if (!isValidSessionName(fullSessionName)) {
    throw new ValidationError(`Invalid session name: ${fullSessionName}`);
  }
  return `${execPathNode} --experimental-strip-types ${scriptPath} --session ${fullSessionName} --listener http://127.0.0.1:${hookPort} --config-dir ${configDir}`;
}

// Mirrors ensureLinkedSession's (tmux.ts) inline `has-session` probe -- not
// exported from tmux.ts since that module's own callers never needed a
// standalone existence check, only this one does.
async function hasSession(fullName: string): Promise<boolean> {
  if (!isValidSessionName(fullName)) {
    throw new ValidationError(`Invalid session name: ${fullName}`);
  }
  try {
    await execFileAsync("tmux", ["has-session", "-t", fullName]);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSendMessageHandler(
  configDir: string,
  worktreesRoot: string,
  hookPort: number,
  waitTimeoutMs: number,
  store: ReturnType<typeof createPendingTaskStore>,
): McpToolDeps["sendMessage"] {
  const projectsFile = join(configDir, "projects.json");
  const scriptPath = hookScriptPath();

  return async ({ project, sessionName, message }) => {
    const projects = await loadProjects(projectsFile);
    const matched = resolveProject(projects, project);
    const sessionSlug = resolveSessionSlug(sessionName);
    const fullSessionName = buildSessionName(matched.id, sessionSlug);
    const worktreePath = resolveWorktreePath(matched.id, sessionSlug, worktreesRoot);
    const hookCommand = buildHookCommand(process.execPath, scriptPath, fullSessionName, hookPort, configDir);

    return sendMessageCore(
      { fullSessionName, worktreePath, hookCommand, message, waitTimeoutMs },
      store,
      {
        hasSession,
        createSession: async (fullName, worktreePathForSession) => {
          await addWorktree(matched.repoPath, worktreePathForSession, sessionSlug);
          try {
            await tmuxCreateSession(fullName, { cwd: worktreePathForSession });
          } catch (error) {
            // Don't leave an orphaned worktree behind when the tmux side
            // fails -- same rollback project-sessions.ts's
            // createProjectSession already does for the identical failure
            // mode.
            await removeWorktree(matched.repoPath, worktreePathForSession, { force: true }).catch(() => {});
            throw error;
          }
        },
        destroySession: async (fullName, worktreePathForSession) => {
          await killSession(fullName).catch(() => {});
          await removeWorktree(matched.repoPath, worktreePathForSession, { force: true }).catch(() => {});
        },
        sendKeys: sendKeysToSession,
        ensureHooks: ensureSessionHooks,
        capturePane,
        sleep,
      },
    );
  };
}

export async function runMcpCommand(args: string[] = [], deps: McpCommandDeps = {}): Promise<void> {
  const options = parseMcpArgs(args);
  const configDir = deps.configDir ?? defaultConfigDir();
  const worktreesRoot = deps.worktreesRoot ?? defaultWorktreesRoot();
  const hookPort = deps.hookPort ?? DEFAULT_HOOK_PORT;
  const waitTimeoutMs = deps.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const hookSecret = await loadOrCreateHookSecret(configDir);

  const store = createPendingTaskStore();
  const hookListener = createHookListener({
    onHookEvent: (session, event) => {
      resolveHookEvent(store, session, event);
    },
    expectedSecret: hookSecret,
  });
  await new Promise<void>((resolve, reject) => {
    hookListener.once("error", reject);
    hookListener.listen(hookPort, "127.0.0.1", () => resolve());
  });

  const sendMessage = buildSendMessageHandler(configDir, worktreesRoot, hookPort, waitTimeoutMs, store);

  if (options.http) {
    const mcpToken = await loadOrCreateMcpToken(configDir);
    // A fresh McpServer per request (see http-server.ts's comment) -- the
    // sendMessage closure above (and the store/config it captures) is
    // still built exactly once and reused across every request.
    const httpServer = createHttpMcpServer(() => createMcpServer({ sendMessage }), { expectedToken: mcpToken });
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(options.port, options.host, () => resolve());
    });
    console.log(`MCP server listening on http://${options.host}:${options.port}/mcp`);
    console.log(`token: ${mcpToken}`);
    console.log(`(persisted at ${configDir}/mcp-token -- reuse it, don't regenerate, or existing clients break)`);
    return;
  }

  await createMcpServer({ sendMessage }).connect(new StdioServerTransport());
}
