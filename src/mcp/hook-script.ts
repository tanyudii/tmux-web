import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadOrCreateHookSecret } from "./hook-secret.ts";

const execFileAsync = promisify(execFileCb);

export interface HookScriptOptions {
  session: string;
  listenerUrl: string;
  // Directory to read the shared secret from (hook-secret.ts's file), not
  // the secret itself -- keeping the secret out of argv (visible to any
  // local user via `ps`/`/proc/<pid>/cmdline`) and out of the
  // settings.local.json file this command string gets written into.
  configDir: string;
}

export interface HookPostedEvent {
  session: string;
  hookEvent: "Stop" | "Notification";
  text: string;
}

export interface HookScriptDeps {
  captureLine: (session: string) => Promise<string>;
  postHookEvent: (listenerUrl: string, event: HookPostedEvent, secret: string) => Promise<void>;
  readStdin: () => Promise<string>;
  loadSecret: (configDir: string) => Promise<string>;
}

// This is what Claude Code pipes to a Stop/Notification hook command's
// stdin (confirmed against the current hook docs) -- only the one field
// this script needs is typed here.
interface ClaudeHookStdin {
  hook_event_name?: string;
}

async function detectHookEvent(deps: HookScriptDeps): Promise<"Stop" | "Notification"> {
  try {
    const raw = await deps.readStdin();
    const parsed = JSON.parse(raw) as ClaudeHookStdin;
    if (parsed.hook_event_name === "Notification") return "Notification";
  } catch {
    // Malformed/missing stdin -- fall back to "Stop" (the safer of the two
    // to guess wrong: Notification's exit code is ignored by Claude Code
    // either way, so nothing downstream depends on getting this exactly
    // right when stdin can't be parsed).
  }
  return "Stop";
}

// Fire-and-forget by design: this always resolves, never throws. A Stop
// hook that exits non-zero (specifically exit code 2) BLOCKS Claude Code
// from stopping -- letting an error here escape would hang the user's real
// interactive session over a purely internal notification failure.
export async function runHookScript(options: HookScriptOptions, deps: HookScriptDeps): Promise<void> {
  const hookEvent = await detectHookEvent(deps);

  let text = "";
  try {
    text = await deps.captureLine(options.session);
  } catch {
    // Session may already be gone (e.g. killed between the turn finishing
    // and the hook firing) -- still report the event so a waiting
    // send_message call resolves with empty text instead of hanging until
    // its own timeout.
  }

  try {
    const secret = await deps.loadSecret(options.configDir);
    await deps.postHookEvent(options.listenerUrl, { session: options.session, hookEvent, text }, secret);
  } catch {
    // Listener unreachable, or the secret file couldn't be read -- nothing
    // more this script can do; the waiting send_message call simply times
    // out on its own.
  }
}

async function defaultCaptureLine(session: string): Promise<string> {
  const { stdout } = await execFileAsync("tmux", ["capture-pane", "-p", "-t", session]);
  return stdout;
}

const POST_TIMEOUT_MS = 3_000;

async function defaultPostHookEvent(listenerUrl: string, event: HookPostedEvent, secret: string): Promise<void> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    await fetch(`${listenerUrl}/hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function defaultReadStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function parseArgs(argv: string[]): HookScriptOptions {
  const sessionIndex = argv.indexOf("--session");
  const listenerIndex = argv.indexOf("--listener");
  const configDirIndex = argv.indexOf("--config-dir");
  const session = sessionIndex >= 0 ? argv[sessionIndex + 1] : undefined;
  const listenerUrl = listenerIndex >= 0 ? argv[listenerIndex + 1] : undefined;
  const configDir = configDirIndex >= 0 ? argv[configDirIndex + 1] : undefined;
  if (!session || !listenerUrl || !configDir) {
    throw new Error("hook-script requires --session <name>, --listener <url>, and --config-dir <path>");
  }
  return { session, listenerUrl, configDir };
}

// Invoked directly by Claude Code as the hook command (see
// hook-config-merge.ts for how the command string, with
// --session/--listener/--config-dir baked in per worktree, gets installed) --
// `node --experimental-strip-types <path>/hook-script.ts --session <name>
// --listener <url> --config-dir <path>`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runHookScript(parseArgs(process.argv.slice(2)), {
    captureLine: defaultCaptureLine,
    postHookEvent: defaultPostHookEvent,
    readStdin: defaultReadStdin,
    loadSecret: loadOrCreateHookSecret,
  }).finally(() => process.exit(0));
}
