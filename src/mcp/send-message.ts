import { beginWait, failWait, SessionBusyError, TaskTimeoutError, type HookEvent } from "./pending-tasks.ts";
import type { PendingTaskStore } from "./pending-tasks.ts";

export interface SendMessageDeps {
  hasSession: (fullName: string) => Promise<boolean>;
  createSession: (fullName: string, worktreePath: string) => Promise<void>;
  // Best-effort rollback for a session this call itself just created but
  // couldn't finish initializing (hooks/launch/readiness all failed) --
  // kills the tmux session and removes the worktree so the next call for
  // this sessionName starts clean instead of finding a permanently broken
  // half-initialized session (see the class comment on waitForReplReady).
  destroySession: (fullName: string, worktreePath: string) => Promise<void>;
  sendKeys: (fullName: string, text: string) => Promise<void>;
  ensureHooks: (worktreePath: string, hookCommand: string) => Promise<void>;
  capturePane: (fullName: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
}

export interface SendMessageOptions {
  fullSessionName: string;
  worktreePath: string;
  hookCommand: string;
  message: string;
  waitTimeoutMs: number;
}

export type SendMessageResult =
  | { status: "result" | "question"; text: string }
  | { status: "busy" }
  | { status: "timeout" };

// Never spawns `claude -p` -- a brand-new session gets a real interactive
// `claude` REPL launched exactly like a human would (typed as a startup
// command, same as session-templates.ts's startupCommand), and every
// subsequent send_message call types straight into that same living REPL.
// Conversation context is never reset between calls.
const CLAUDE_LAUNCH_COMMAND = "claude";

// Polling interval/ceiling for waitForReplReady below.
const REPL_READY_POLL_INTERVAL_MS = 300;
const REPL_READY_MAX_WAIT_MS = 10_000;

// Waits for the pane's visible content to stop changing between two
// consecutive polls (and be non-empty) before returning -- a proxy for "the
// claude REPL has finished drawing and is idle at its prompt", without
// depending on matching claude's exact banner text (which could change
// between versions). This replaces an earlier fixed-delay sleep: typing
// options.message before the REPL is actually ready risked it landing on
// the underlying shell prompt instead (executing as an unconfirmed shell
// command rather than being interpreted by Claude Code) if `claude` ever
// took longer than the fixed delay to start. If the pane never stabilizes
// within REPL_READY_MAX_WAIT_MS, this gives up and proceeds anyway --
// typing into a still-changing pane is safer than hanging the whole call
// indefinitely on a slow-starting REPL.
async function waitForReplReady(deps: SendMessageDeps, fullSessionName: string): Promise<void> {
  const deadline = Date.now() + REPL_READY_MAX_WAIT_MS;
  let previous: string | null = null;
  while (Date.now() < deadline) {
    const current = await deps.capturePane(fullSessionName);
    if (previous !== null && current === previous && current.trim().length > 0) return;
    previous = current;
    await deps.sleep(REPL_READY_POLL_INTERVAL_MS);
  }
}

export async function sendMessage(
  options: SendMessageOptions,
  store: PendingTaskStore,
  deps: SendMessageDeps,
): Promise<SendMessageResult> {
  let waitPromise: Promise<HookEvent>;
  try {
    // Synchronous claim + resolver registration in one call, no await
    // before it -- see beginWait's own comment for why splitting this into
    // two steps previously left a real race.
    waitPromise = beginWait(store, options.fullSessionName, options.waitTimeoutMs);
  } catch (error) {
    if (error instanceof SessionBusyError) return { status: "busy" };
    throw error;
  }
  // Safety net only: if setup below throws and we rethrow before ever
  // awaiting waitPromise ourselves, failWait may have already rejected it --
  // without a handler attached here that would surface as an unhandled
  // promise rejection. The real rejection/resolution is still observed via
  // `await waitPromise` in the success path further down.
  waitPromise.catch(() => {});

  try {
    const exists = await deps.hasSession(options.fullSessionName);
    if (!exists) {
      await deps.createSession(options.fullSessionName, options.worktreePath);
      try {
        // Hooks must be installed before `claude` starts -- Claude Code
        // reads .claude/settings.local.json at startup, not on every turn.
        await deps.ensureHooks(options.worktreePath, options.hookCommand);
        await deps.sendKeys(options.fullSessionName, CLAUDE_LAUNCH_COMMAND);
        await waitForReplReady(deps, options.fullSessionName);
      } catch (error) {
        // A session that fails partway through init (hooks installed but
        // claude never launched, or vice versa) would otherwise look
        // "exists" forever to future calls (deps.hasSession only checks
        // tmux session existence) while never actually running claude or
        // having working hooks -- permanently stuck. Tear it down so the
        // next call starts clean instead.
        await deps.destroySession(options.fullSessionName, options.worktreePath).catch(() => {});
        throw error;
      }
    }
    await deps.sendKeys(options.fullSessionName, options.message);
  } catch (error) {
    failWait(store, options.fullSessionName, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }

  try {
    const event = await waitPromise;
    return { status: event.hookEvent === "Stop" ? "result" : "question", text: event.text };
  } catch (error) {
    if (error instanceof TaskTimeoutError) return { status: "timeout" };
    throw error;
  }
}
