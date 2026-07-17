import { WebSocketServer, type WebSocket } from "ws";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "./server.ts";
import { readConfig, ConfigError, defaultConfigDir } from "./config.ts";
import { resolveWebBuildDir } from "./web-build.ts";
import {
  listSessions,
  listWindows,
  createSession,
  killSession,
  sendKeysToSession,
  isValidSessionName,
  setBellHook,
  ensureLinkedSession,
} from "./tmux.ts";
import { parseSessionName, splitPaneSessionName } from "./session-naming.ts";
import {
  loadOrCreateVapidKeys,
  addPushSubscription,
  removePushSubscription,
  sendBellPush,
  BellPushDebouncer,
} from "./push-notifications.ts";
import { extractQueryToken, verifyToken } from "./auth.ts";
import { RateLimiter } from "./rate-limit.ts";
import { attachPtyToSocket, type SocketLike } from "./pty-bridge.ts";
import {
  loadProjects,
  registerProject as registerProjectImpl,
  removeProject as removeProjectImpl,
  getProject as getProjectImpl,
} from "./projects.ts";
import { isGitRepo, addWorktree, removeWorktree } from "./worktree.ts";
import { listDirectory as listDirectoryImpl } from "./directory-browser.ts";
import { getChangedFiles, getFileDiff, stageFile, unstageFile, discardFile, commitStaged } from "./git-status.ts";
import {
  listProjectSessions as listProjectSessionsImpl,
  startProjectSessionCreation as startProjectSessionCreationImpl,
  getSessionCreationStatus as getSessionCreationStatusImpl,
  createSessionCreationStore,
  killProjectSession as killProjectSessionImpl,
  killProjectSessionSplit as killProjectSessionSplitImpl,
  getProjectSessionChanges as getProjectSessionChangesImpl,
  getProjectSessionDiff as getProjectSessionDiffImpl,
  stageProjectSessionFile as stageProjectSessionFileImpl,
  unstageProjectSessionFile as unstageProjectSessionFileImpl,
  discardProjectSessionFile as discardProjectSessionFileImpl,
  commitProjectSessionChanges as commitProjectSessionChangesImpl,
  listProjectSessionEnvFiles as listProjectSessionEnvFilesImpl,
  readProjectSessionEnvFile as readProjectSessionEnvFileImpl,
  writeProjectSessionEnvFile as writeProjectSessionEnvFileImpl,
  type ProjectSessionsDeps,
} from "./project-sessions.ts";
import {
  listProjectTemplates as listProjectTemplatesImpl,
  createTemplate as createTemplateImpl,
  updateTemplate as updateTemplateImpl,
  deleteTemplate as deleteTemplateImpl,
} from "./session-templates.ts";
import { loadEnvConfig } from "./env-config.ts";
import { listEnvFiles, readEnvFile, writeEnvFile } from "./env-editor.ts";
import { composeUp, composeDown, composePs, composePort, checkPortCollisions } from "./docker-compose.ts";
import { runScript } from "./run-script.ts";
import {
  getSessionEnvStatus as getSessionEnvStatusImpl,
  startSessionEnv as startSessionEnvImpl,
  stopSessionEnv as stopSessionEnvImpl,
  cancelSessionEnv as cancelSessionEnvImpl,
  requireEnvContext,
  createSessionEnvStore,
  createSessionEnvControllerStore,
  EnvUnavailableError,
  type SessionEnvDeps,
} from "./session-env.ts";
import { attachLogsToSocket, type LogSocketLike } from "./log-stream.ts";
import { sanitizeServiceName } from "./service-name.ts";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

// VAPID subject per RFC 8292 -- required by the spec but push services
// (Chrome/Firefox's own endpoints) don't actually validate or contact it;
// it's a fixed placeholder rather than a real mailbox, same as other
// self-hosted apps that don't have a per-install contact address to use.
const VAPID_SUBJECT = "mailto:tmux-web@localhost";

// Debounces repeated pushes for the same session's bell -- a busy command
// (progress bars, build output) can emit many BEL bytes in a row; without
// this every one would fan out its own push to every subscribed device.
const BELL_PUSH_COOLDOWN_MS = 30_000;

// Default location of the KMP Web client's compiled output relative to this
// file (src/main.ts) -- see kmp/composeApp/build.gradle.kts's wasmJs target
// and .claude/plans/rebuild-web-ios-kmp.plan.md Phase 6 "Cutover".
// Overridable via TMUX_WEB_PUBLIC_DIR for non-standard install layouts.
const DEFAULT_WEB_BUILD_DIR = fileURLToPath(
  new URL("../kmp/composeApp/build/dist/wasmJs/productionExecutable", import.meta.url),
);

interface DestroyableSocket {
  write(data: string): void;
  destroy(): void;
}

function rejectUpgrade(socket: DestroyableSocket, status: number, reason: string, retryAfterSeconds?: number): void {
  const retryHeader = retryAfterSeconds !== undefined ? `Retry-After: ${retryAfterSeconds}\r\n` : "";
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n${retryHeader}\r\n`);
  socket.destroy();
}

// Mirrors server.ts's AUTH_FAILURE_LIMIT -- WS upgrades bypass createServer()
// entirely (handled directly on the raw `upgrade` event below), so they'd
// otherwise have no brute-force protection of their own.
function rejectUnauthorizedUpgrade(socket: DestroyableSocket, clientIp: string, limiter: RateLimiter): void {
  const result = limiter.check(clientIp);
  if (result.limited) {
    rejectUpgrade(socket, 429, "Too Many Requests", Math.ceil(result.retryAfterMs / 1000));
  } else {
    rejectUpgrade(socket, 401, "Unauthorized");
  }
}

export async function main(): Promise<void> {
  const configDir = defaultConfigDir();
  let config;
  try {
    config = await readConfig(configDir);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const projectsFile = join(configDir, "projects.json");
  const templatesFile = join(configDir, "session-templates.json");
  const worktreesRoot = join(configDir, "worktrees");

  const sessionEnvDeps: SessionEnvDeps = {
    loadEnvConfig,
    runScript,
    composeUp,
    composeDown,
    composePs,
    composePort,
    checkPortCollisions,
    worktreesRoot,
  };
  const sessionEnvStore = createSessionEnvStore();
  const sessionEnvControllers = createSessionEnvControllerStore();
  const sessionCreationStore = createSessionCreationStore();

  const projectSessionsDeps: ProjectSessionsDeps = {
    listSessions,
    listWindows,
    createSession,
    killSession,
    sendKeys: sendKeysToSession,
    addWorktree,
    removeWorktree,
    getChangedFiles,
    getFileDiff,
    stageFile,
    unstageFile,
    discardFile,
    commitStaged,
    listEnvFiles,
    readEnvFile,
    writeEnvFile,
    stopSessionEnv: (project, sessionSlug) =>
      stopSessionEnvImpl(project, sessionSlug, sessionEnvDeps, sessionEnvStore),
    worktreesRoot,
  };

  const webBuildDir = resolveWebBuildDir(process.env.TMUX_WEB_PUBLIC_DIR ?? DEFAULT_WEB_BUILD_DIR);
  if (!webBuildDir) {
    console.log(
      `Web client build not found (looked in ${process.env.TMUX_WEB_PUBLIC_DIR ?? DEFAULT_WEB_BUILD_DIR}) -- ` +
        "serving API only. Run `./gradlew :composeApp:wasmJsBrowserDistribution` in kmp/ to enable it.",
    );
  }

  const browseRoot = process.env.TMUX_WEB_BROWSE_ROOT;

  const vapidKeys = await loadOrCreateVapidKeys(configDir);
  const bellPushDebouncer = new BellPushDebouncer(BELL_PUSH_COOLDOWN_MS);

  // Driven by /internal/bell (server.ts), itself driven by the tmux
  // `alert-bell` hook set in setBellHook below -- fires even when no
  // browser tab has this session's terminal open, since the hook is tmux's
  // own bell-monitoring rather than anything relayed through a WS. The
  // session slug (not the opaque project-id-prefixed full name) is used as
  // the human-readable label, matching BellAlert.kt's buildBellTitle.
  async function notifyBellImpl(sessionFullName: string): Promise<void> {
    if (!bellPushDebouncer.shouldSend(sessionFullName)) return;
    const label = parseSessionName(sessionFullName)?.sessionSlug ?? sessionFullName;
    await sendBellPush(configDir, { subject: VAPID_SUBJECT, ...vapidKeys }, {
      title: `🔔 ${label} needs you`,
      body: "tmux-web",
    });
  }

  const httpServer = createServer({
    token: config.token,
    publicDir: webBuildDir,

    listProjects: () => loadProjects(projectsFile),
    registerProject: (name, repoPath) =>
      registerProjectImpl(projectsFile, name, repoPath, { isGitRepo }),
    getProject: (id) => getProjectImpl(projectsFile, id),
    removeProject: (id) => removeProjectImpl(projectsFile, id),
    // Directory browser's default starting point is os.homedir() unless
    // overridden -- useful when the service account's $HOME isn't where
    // repos actually live (or, as here, when $HOME is repurposed for an
    // isolated config dir, e.g. a throwaway dev/preview instance).
    browseDirectory: (path) =>
      listDirectoryImpl(path, browseRoot ? { homedir: () => browseRoot } : {}),

    listProjectSessions: (project) => listProjectSessionsImpl(project, projectSessionsDeps),
    startProjectSessionCreation: (project, name, startupCommand) =>
      startProjectSessionCreationImpl(project, name, projectSessionsDeps, sessionCreationStore, startupCommand),
    getProjectSessionCreationStatus: (project, slug) =>
      getSessionCreationStatusImpl(project, slug, sessionCreationStore),
    killProjectSession: (project, slug, options) =>
      killProjectSessionImpl(project, slug, projectSessionsDeps, options),
    killProjectSessionSplit: (project, slug) =>
      killProjectSessionSplitImpl(project, slug, projectSessionsDeps),

    getProjectSessionChanges: (project, slug) =>
      getProjectSessionChangesImpl(project, slug, projectSessionsDeps),
    getProjectSessionDiff: (project, slug, filePath, mode) =>
      getProjectSessionDiffImpl(project, slug, filePath, mode, projectSessionsDeps),
    stageProjectSessionFile: (project, slug, filePath) =>
      stageProjectSessionFileImpl(project, slug, filePath, projectSessionsDeps),
    unstageProjectSessionFile: (project, slug, filePath) =>
      unstageProjectSessionFileImpl(project, slug, filePath, projectSessionsDeps),
    discardProjectSessionFile: (project, slug, filePath, mode) =>
      discardProjectSessionFileImpl(project, slug, filePath, mode, projectSessionsDeps),
    commitProjectSessionChanges: (project, slug, message) =>
      commitProjectSessionChangesImpl(project, slug, message, projectSessionsDeps),
    listProjectSessionEnvFiles: (project, slug) =>
      listProjectSessionEnvFilesImpl(project, slug, projectSessionsDeps),
    readProjectSessionEnvFile: (project, slug, filename) =>
      readProjectSessionEnvFileImpl(project, slug, filename, projectSessionsDeps),
    writeProjectSessionEnvFile: (project, slug, filename, content) =>
      writeProjectSessionEnvFileImpl(project, slug, filename, content, projectSessionsDeps),

    getProjectSessionEnvStatus: (project, slug, requestHost) =>
      getSessionEnvStatusImpl(project, slug, sessionEnvDeps, sessionEnvStore, requestHost),
    startProjectSessionEnv: (project, slug) =>
      startSessionEnvImpl(project, slug, sessionEnvDeps, sessionEnvStore, sessionEnvControllers),
    stopProjectSessionEnv: (project, slug) =>
      stopSessionEnvImpl(project, slug, sessionEnvDeps, sessionEnvStore),
    cancelProjectSessionEnv: (project, slug) =>
      Promise.resolve(cancelSessionEnvImpl(project, slug, sessionEnvStore, sessionEnvControllers)),

    getPushPublicKey: () => vapidKeys.publicKey,
    subscribePush: (subscription) => addPushSubscription(configDir, subscription),
    unsubscribePush: (endpoint) => removePushSubscription(configDir, endpoint),
    notifyBell: notifyBellImpl,

    listProjectTemplates: (project) => listProjectTemplatesImpl(templatesFile, project.id),
    createProjectTemplate: (project, name, startupCommand) =>
      createTemplateImpl(templatesFile, project.id, name, startupCommand),
    updateProjectTemplate: (project, templateId, name, startupCommand) =>
      updateTemplateImpl(templatesFile, project.id, templateId, name, startupCommand),
    deleteProjectTemplate: (project, templateId) => deleteTemplateImpl(templatesFile, project.id, templateId),
  });

  const wss = new WebSocketServer({ noServer: true });
  const wsAuthFailureLimiter = new RateLimiter({ windowMs: 60_000, max: 10 });

  httpServer.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const token = extractQueryToken(req.url ?? "");
    const clientIp = req.socket.remoteAddress ?? "unknown";

    if (url.pathname === "/ws") {
      const sessionName = url.searchParams.get("session") ?? "";
      // EMB-217: `pane=1` attaches to a linked tmux session instead of the
      // primary one, so the split viewport can independently browse a
      // different window than pane 0 -- see splitPaneSessionName's doc
      // comment (session-naming.ts) for why this is a linked session
      // rather than the same session twice.
      const isSplitPane = url.searchParams.get("pane") === "1";

      if (!isValidSessionName(sessionName) || !verifyToken(token, config.token)) {
        rejectUnauthorizedUpgrade(socket, clientIp, wsAuthFailureLimiter);
        return;
      }

      let targetSessionName = sessionName;
      if (isSplitPane) {
        targetSessionName = splitPaneSessionName(sessionName);
        try {
          await ensureLinkedSession(targetSessionName, sessionName);
        } catch {
          rejectUpgrade(socket, 500, "Internal Server Error");
          return;
        }
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        attachPtyToSocket(
          ws as unknown as WebSocket & SocketLike,
          targetSessionName,
          DEFAULT_COLS,
          DEFAULT_ROWS,
        );
        // Best-effort and fire-and-forget: re-set on every attach (not just
        // session creation) so it self-heals for sessions created before
        // this feature shipped and after a server restart on a different
        // port -- see setBellHook's doc comment. A failure here (e.g. tmux
        // gone) must never block the terminal itself from working. Only
        // set from the primary pane: both linked sessions share the same
        // underlying windows, so setting this hook on the split session
        // too would fire the bell push notification twice per bell.
        if (!isSplitPane) {
          void setBellHook(sessionName, config.port).catch(() => {});
        }
      });
      return;
    }

    if (url.pathname === "/ws/logs") {
      if (!verifyToken(token, config.token)) {
        rejectUnauthorizedUpgrade(socket, clientIp, wsAuthFailureLimiter);
        return;
      }

      const projectId = url.searchParams.get("project") ?? "";
      const sessionSlug = url.searchParams.get("session") ?? "";
      const service = sanitizeServiceName(url.searchParams.get("service"));

      // Resolving the ComposeContext touches the filesystem (project
      // registry + the worktree's .tmux-web-env/), so -- unlike the /ws
      // branch above -- this can't be validated synchronously before the
      // upgrade.
      try {
        const project = await getProjectImpl(projectsFile, projectId);
        if (!project) {
          rejectUpgrade(socket, 404, "Not Found");
          return;
        }

        const ctx = await requireEnvContext(project, sessionSlug, sessionEnvDeps);

        wss.handleUpgrade(req, socket, head, (ws) => {
          attachLogsToSocket(ws as unknown as LogSocketLike, ctx, service);
        });
      } catch (error) {
        const status = error instanceof EnvUnavailableError ? 404 : 400;
        rejectUpgrade(socket, status, status === 404 ? "Not Found" : "Bad Request");
      }
      return;
    }

    socket.destroy();
  });

  httpServer.listen(config.port, config.host, () => {
    console.log(`tmux-web listening on http://${config.host}:${config.port}`);
    console.log(`data dir: ${configDir}`);
  });
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main();
}
