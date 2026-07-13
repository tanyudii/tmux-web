import type { Project } from "./projects.ts";
import { buildSessionName } from "./session-naming.ts";
import { resolveWorktreePath } from "./worktree.ts";
import type { EnvConfig } from "./env-config.ts";
import type { ComposeContext, ComposeServiceStatus } from "./docker-compose.ts";

export class EnvUnavailableError extends Error {}
export class EnvAlreadyRunningError extends Error {}
export class EnvNotRunningError extends Error {}

export type EnvPhase = "unavailable" | "idle" | "starting" | "running" | "error" | "stopping";

export interface EnvStatus {
  phase: EnvPhase;
  openUrl?: string;
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

export interface SessionEnvDeps {
  loadEnvConfig: (worktreePath: string) => Promise<EnvConfig | null>;
  runScript: (scriptPath: string, cwd: string) => Promise<{ stdout: string; stderr: string }>;
  composeUp: (ctx: ComposeContext) => Promise<void>;
  composeDown: (ctx: ComposeContext) => Promise<void>;
  composePs: (ctx: ComposeContext) => Promise<ComposeServiceStatus[]>;
  composePort: (ctx: ComposeContext, service: string, containerPort: number) => Promise<number | null>;
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

async function resolveOpenUrl(
  deps: SessionEnvDeps,
  ctx: ComposeContext,
  config: EnvConfig,
): Promise<string | undefined> {
  if (!config.openService || config.openPort == null) return undefined;
  const hostPort = await deps.composePort(ctx, config.openService, config.openPort);
  if (hostPort == null) return undefined;
  return `http://${deps.openHost ?? "localhost"}:${hostPort}`;
}

async function requireConfig(
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

export async function getSessionEnvStatus(
  project: Project,
  sessionSlug: string,
  deps: SessionEnvDeps,
  store: SessionEnvStore,
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
    const openUrl = services.length ? await resolveOpenUrl(deps, ctx, config) : undefined;
    return { phase: "error", message: transient.message, services: services.length ? services : undefined, openUrl };
  }

  if (services.length === 0) return { phase: "idle" };

  const openUrl = await resolveOpenUrl(deps, ctx, config);
  return { phase: "running", openUrl, services };
}

export async function startSessionEnv(
  project: Project,
  sessionSlug: string,
  deps: SessionEnvDeps,
  store: SessionEnvStore,
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

  // Deliberately not awaited: pre-run/compose up/post-run can take minutes
  // (image pulls, builds, migrations). The HTTP layer returns as soon as
  // this function resolves; progress from here on is observed by polling
  // getSessionEnvStatus, which reads the store entry set below.
  void runLifecycle(fullName, worktreePath, config, ctx, deps, store);
}

async function runLifecycle(
  fullName: string,
  worktreePath: string,
  config: EnvConfig,
  ctx: ComposeContext,
  deps: SessionEnvDeps,
  store: SessionEnvStore,
): Promise<void> {
  try {
    if (config.preRunScript) await deps.runScript(config.preRunScript, worktreePath);
    await deps.composeUp(ctx);
    if (config.postRunScript) await deps.runScript(config.postRunScript, worktreePath);
    store.delete(fullName);
  } catch (error) {
    store.set(fullName, {
      phase: "error",
      message: error instanceof Error ? error.message : String(error),
    });
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

  store.set(fullName, { phase: "stopping" });
  try {
    await deps.composeDown(ctx);
  } finally {
    store.delete(fullName);
  }
}
