import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// `.claude/settings.local.json` (not the global ~/.claude/settings.json, and
// not the checked-in `.claude/settings.json`) is scoped to exactly this
// worktree and is git-ignored by Claude Code's own convention -- installing
// the send_message hook here never touches the user's real global config,
// and it naturally disappears when the session's worktree is removed
// (worktree.ts's removeWorktree), so there's nothing to clean up separately.
export function settingsLocalPath(worktreePath: string): string {
  return join(worktreePath, ".claude", "settings.local.json");
}

interface HookCommandEntry {
  type: "command";
  command: string;
  async: boolean;
  timeout: number;
}

interface HookMatcherEntry {
  matcher?: string;
  hooks: HookCommandEntry[];
}

interface ClaudeSettings {
  hooks?: {
    Stop?: HookMatcherEntry[];
    Notification?: HookMatcherEntry[];
  };
  [key: string]: unknown;
}

// Stop hooks ignore `matcher` entirely; Notification hooks require one, and
// "*" is Claude Code's documented "match every notification type" value --
// send_message needs every Notification (permission prompts, idle prompts,
// etc.), not just one kind, since any of them means "the session needs
// input" from this app's point of view.
const HOOK_TIMEOUT_SECONDS = 600;

function buildEntry(command: string, matcher?: string): HookMatcherEntry {
  return {
    ...(matcher !== undefined ? { matcher } : {}),
    // async: true mirrors tmux.ts's setBellHook backgrounding its curl call
    // -- the hook must never make Claude Code itself wait on this app.
    hooks: [{ type: "command", command, async: true, timeout: HOOK_TIMEOUT_SECONDS }],
  };
}

function hasCommand(entries: HookMatcherEntry[] | undefined, command: string): boolean {
  return (entries ?? []).some((entry) => entry.hooks.some((hook) => hook.command === command));
}

async function readExistingSettings(filePath: string): Promise<ClaudeSettings> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as ClaudeSettings) : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {};
    throw error;
  }
}

// Idempotent: safe to call every time a send_message-managed session is
// (re)started -- re-adds nothing if `command` is already present for either
// event, so repeated calls never grow the file.
export async function ensureSessionHooks(worktreePath: string, command: string): Promise<void> {
  const filePath = settingsLocalPath(worktreePath);
  const settings = await readExistingSettings(filePath);
  const hooks = settings.hooks ?? {};

  const stop = hooks.Stop ?? [];
  const notification = hooks.Notification ?? [];

  const updated: ClaudeSettings = {
    ...settings,
    hooks: {
      ...hooks,
      Stop: hasCommand(stop, command) ? stop : [...stop, buildEntry(command)],
      Notification: hasCommand(notification, command) ? notification : [...notification, buildEntry(command, "*")],
    },
  };

  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  // Owner-only, mirroring hook-secret.ts and config.ts's own token file --
  // the hook `command` string embedded here references hook-script.ts,
  // which itself reads the shared secret from hook-secret.ts's 0600 file
  // rather than taking it as an argument, but this file shouldn't be
  // world-readable regardless (git worktree contents are otherwise not
  // secret, this one file is the exception).
  await writeFile(tempPath, JSON.stringify(updated, null, 2), { mode: 0o600 });
  await rename(tempPath, filePath);
}
