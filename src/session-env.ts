import type { Project } from "./projects.ts";
import { buildSessionName } from "./session-naming.ts";
import { resolveWorktreePath } from "./worktree.ts";
import type { EnvConfig } from "./env-config.ts";
import type { ComposeContext, ComposeServiceStatus } from "./docker-compose.ts";

export class EnvUnavailableError extends Error {}
export class EnvAlreadyRunningError extends Error {}
export class EnvNotRunningError extends Error {}
export class EnvNotStartingError extends Error {}

export type EnvPhase = "unavailable" | "idle" | "starting" | "running" | "error" | "stopping";

export interface ResolvedOpenLink {
  label: string;
  url: string;
  service: string;
}

export interface EnvStatus {
  phase: EnvPhase;
  openLinks?: ResolvedOpenLink[];
  message?: string;
  services?: ComposeServiceStatus[];
}

// Only the phases docker itself can't tell us about need to live here --
// "idle"/"running" are always derived live from `composePs`, the same way
// tmux/git are already treated as the source of truth elsewhere in this
// codebase, so a status check never trusts a stale cached "running" after
// e.g. someone ran `docker compose down` outside tmux-web.
interface TransientState {
  phase: "starting" | "stopping" | "error";
  message?: string;
}

export type SessionEnvStore = Map<string, TransientState>;

export function createSessionEnvStore(): SessionEnvStore {
  return new Map();
}

// Separate from SessionEnvStore because TransientState is replaced wholesale
// on every lifecycle step (see runLifecycle's store.set calls below) --
// keeping the controller here means cancelSessionEnv can always find it
// regardless of which step is currently in flight.
export type SessionEnvControllerStore = Map<string, AbortController>;

export function createSessionEnvControllerStore(): SessionEnvControllerStore {
  return new Map();
}

export interface SessionEnvDeps {
  loadEnvConfig: (worktreePath: string) => Promise<EnvConfig | null>;
  runScript: (
    scriptPath: string,
    cwd: string,
    exec?: undefined,
    signal?: AbortSignal,
  ) => Promise<{ stdout: string; stderr: string }>;
  composeUp: (ctx: ComposeContext, exec?: undefined, signal?: AbortSignal) => Promise<void>;
  composeDown: (ctx: ComposeContext) => Promise<void>;
  composePs: (ctx: ComposeContext) => Promise<ComposeServiceStatus[]>;
  composePort: (ctx: ComposeContext, service: string, containerPort: number) => Promise<number | null>;
  checkPortCollisions: (ctx: ComposeContext) => Promise<void>;
  worktreesRoot?: string;
  openHost?: string;
}

function contextFor(fullName: string, worktreePath: string, config: EnvConfig): ComposeContext {
  return { projectName: fullName, composeFile: config.composeFile, worktreePath };
}

async function safeComposePs(deps: SessionEnvDeps, ctx: ComposeContext): Promise<ComposeServiceStatus[]> {
  try {
    return await deps.composePs(ctx);
  } catch {
    return [];
  }
}

// Resolves every configured open-link independently and in parallel -- one
// service not having published its port yet (e.g. still starting) never
// blocks the others from showing up.
async function resolveOpenLinks(
  deps: SessionEnvDeps,
  ctx: ComposeContext,
  config: EnvConfig,
  requestHost?: string,
): Promise<ResolvedOpenLink[]> {
  const resolved = await Promise.all(
    config.openLinks.map(async (link) => {
      const hostPort = await deps.composePort(ctx, link.service, link.port);
      if (hostPort == null) return null;
      // requestHost (the Host header of whatever request asked for this
      // status -- see server.ts) wins: it's whatever address the browser is
      // CURRENTLY using to reach tmux-web itself (127.0.0.1, a LAN IP, a VPN
      // IP, ...), so every "Open" link keeps working no matter which of
      // those the user is on right now. deps.openHost is a static fallback
      // for callers that don't have a request (e.g. tests, or a future
      // non-HTTP caller); "localhost" is the last resort when neither is
      // available.
      const host = requestHost ?? deps.openHost ?? "localhost";
      return { label: link.label, url: `http://${host}:${hostPort}`, service: link.service };
    }),
  );
  return resolved.filter((link): link is ResolvedOpenLink => link !== null);
}

export async function requireConfig(
  project: Project,
  sessionSlug: string,
  deps: SessionEnvDeps,
): Promise<{ fullName: string; worktreePath: string; config: EnvConfig }> {
  const fullName = buildSessionName(project.id, sessionSlug);
  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  const config = await deps.loadEnvConfig(worktreePath);
  if (!config) {
    throw new EnvUnavailableError(
      `No .tmux-web-env/docker-compose.yml for session "${sessionSlug}" -- this project hasn't opted in`,
    );
  }
  return { fullName, worktreePath, config };
}

// Shared by the /ws/logs upgrade handler in main.ts, so it resolves the
// same project-scoped ComposeContext that startSessionEnv/stopSessionEnv
// already use internally, without duplicating the opt-in check.
export async function requireEnvContext(
  project: Project,
  sessionSlug: string,
  deps: SessionEnvDeps,
): Promise<ComposeContext> {
  const { fullName, worktreePath, config } = await requireConfig(project, sessionSlug, deps);
  return contextFor(fullName, worktreePath, config);
}

export async function getSessionEnvStatus(
  project: Project,
  sessionSlug: string,
  deps: SessionEnvDeps,
  store: SessionEnvStore,
  requestHost?: string,
): Promise<EnvStatus> {
  const fullName = buildSessionName(project.id, sessionSlug);
  const worktreePath = resolveWorktreePath(project.id, sessionSlug, deps.worktreesRoot);
  const config = await deps.loadEnvConfig(worktreePath);
  if (!config) return { phase: "unavailable" };

  const transient = store.get(fullName);
  if (transient?.phase === "starting" || transient?.phase === "stopping") {
    return { phase: transient.phase, message: transient.message };
  }

  const ctx = contextFor(fullName, worktreePath, config);
  const services = await safeComposePs(deps, ctx);

  if (transient?.phase === "error") {
    const openLinks = services.length ? await resolveOpenLinks(deps, ctx, config, requestHost) : [];
    return {
      phase: "error",
      message: transient.message,
      services: services.length ? services : undefined,
      openLinks: openLinks.length ? openLinks : undefined,
    };
  }

  if (services.length === 0) return { phase: "idle" };

  const openLinks = await resolveOpenLinks(deps, ctx, config, requestHost);
  return { phase: "running", openLinks: openLinks.length ? openLinks : undefined, services };
}

export async function startSessionEnv(
  project: Project,
  sessionSlug: string,
  deps: SessionEnvDeps,
  store: SessionEnvStore,
  controllers: SessionEnvControllerStore,
): Promise<void> {
  const { fullName, worktreePath, config } = await requireConfig(project, sessionSlug, deps);

  if (store.has(fullName)) {
    throw new EnvAlreadyRunningError(`Environment for "${sessionSlug}" is already starting`);
  }
  // Claim the slot synchronously -- no `await` between this check and the
  // set -- so a second, truly concurrent start() call for the same
  // session can never slip through the gap and run a duplicate
  // pre-run/compose-up/post-run (a TOCTOU race the previous version had,
  // since it only claimed the slot after awaiting composePs below).
  store.set(fullName, { phase: "starting" });

  const ctx = contextFor(fullName, worktreePath, config);
  if ((await safeComposePs(deps, ctx)).length > 0) {
    store.delete(fullName);
    throw new EnvAlreadyRunningError(`Environment for "${sessionSlug}" is already running`);
  }

  try {
    await deps.checkPortCollisions(ctx);
  } catch (error) {
    store.delete(fullName);
    throw error;
  }

  const controller = new AbortController();
  controllers.set(fullName, controller);

  // Deliberately not awaited: pre-run/compose up/post-run can take minutes
  // (image pulls, builds, migrations). The HTTP layer returns as soon as
  // this function resolves; progress from here on is observed by polling
  // getSessionEnvStatus, which reads the store entry set below.
  void runLifecycle(fullName, worktreePath, config, ctx, deps, store, controllers, controller.signal);
}

/**
 * Aborts a setup currently in flight (see [EnvPhase] "starting") -- EMB-209.
 * The in-flight `runScript`/`composeUp` call's `AbortSignal` propagates
 * straight to Node's `child_process.execFile` `signal` option, which sends
 * SIGTERM to the actual `sh`/`docker` child process; `runLifecycle`'s catch
 * block below recognizes the resulting [ComposeCancelledError]/
 * [ScriptCancelledError] and leaves the environment in a clearly-labeled
 * "Cancelled" state rather than a stuck "Setting up…".
 */
export function cancelSessionEnv(
  project: Project,
  sessionSlug: string,
  store: SessionEnvStore,
  controllers: SessionEnvControllerStore,
): void {
  const fullName = buildSessionName(project.id, sessionSlug);
  const transient = store.get(fullName);
  const controller = controllers.get(fullName);
  if (!transient || transient.phase !== "starting" || !controller) {
    throw new EnvNotStartingError(`Environment for "${sessionSlug}" is not currently starting`);
  }
  controller.abort();
}

async function runLifecycle(
  fullName: string,
  worktreePath: string,
  config: EnvConfig,
  ctx: ComposeContext,
  deps: SessionEnvDeps,
  store: SessionEnvStore,
  controllers: SessionEnvControllerStore,
  signal: AbortSignal,
): Promise<void> {
  try {
    if (config.preRunScript) {
      store.set(fullName, { phase: "starting", message: "Running pre-run script…" });
      await deps.runScript(config.preRunScript, worktreePath, undefined, signal);
    }
    store.set(fullName, { phase: "starting", message: "Pulling and starting containers…" });
    await deps.composeUp(ctx, undefined, signal);
    if (config.postRunScript) {
      store.set(fullName, { phase: "starting", message: "Running post-run script…" });
      await deps.runScript(config.postRunScript, worktreePath, undefined, signal);
    }
    store.delete(fullName);
  } catch (error) {
    store.set(fullName, {
      phase: "error",
      message: signal.aborted ? "Cancelled" : error instanceof Error ? error.message : String(error),
    });
  } finally {
    controllers.delete(fullName);
  }
}

export async function stopSessionEnv(
  project: Project,
  sessionSlug: string,
  deps: SessionEnvDeps,
  store: SessionEnvStore,
): Promise<void> {
  const { fullName, worktreePath, config } = await requireConfig(project, sessionSlug, deps);

  const ctx = contextFor(fullName, worktreePath, config);
  const transient = store.get(fullName);
  const services = await safeComposePs(deps, ctx);

  if (!transient && services.length === 0) {
    throw new EnvNotRunningError(`Environment for "${sessionSlug}" is not running`);
  }

  store.set(fullName, { phase: "stopping", message: "Stopping containers and removing volumes…" });
  try {
    await deps.composeDown(ctx);
  } finally {
    store.delete(fullName);
  }
}
