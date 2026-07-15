import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
}

export interface TmuxWindow {
  index: number;
  name: string;
}

export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string }>;

const SESSION_LIST_FORMAT = "#{session_name}\t#{session_windows}\t#{session_attached}";
const WINDOW_LIST_FORMAT = "#{window_index}\t#{window_name}";

// tmux session names may not contain ':' (target separator), must not start
// with '-' (would be parsed as a CLI flag), and are kept free of shell
// metacharacters even though we always invoke tmux via execFile (no shell).
const VALID_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

export function isValidSessionName(name: string): boolean {
  return VALID_NAME_PATTERN.test(name);
}

export class ValidationError extends Error {}

export function parseSessionList(output: string): TmuxSession[] {
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [name, windows, attached] = line.split("\t");
      return {
        name,
        windows: Number.parseInt(windows, 10),
        attached: attached === "1",
      };
    });
}

function defaultExec(file: string, args: string[]): Promise<{ stdout: string }> {
  return execFileAsync(file, args);
}

function isNoServerRunningError(error: unknown): boolean {
  const stderr = (error as { stderr?: string })?.stderr ?? "";
  return /no server running/i.test(stderr);
}

export async function listSessions(exec: ExecFn = defaultExec): Promise<TmuxSession[]> {
  try {
    const { stdout } = await exec("tmux", ["list-sessions", "-F", SESSION_LIST_FORMAT]);
    return parseSessionList(stdout);
  } catch (error) {
    if (isNoServerRunningError(error)) return [];
    throw error;
  }
}

export function parseWindowList(output: string): TmuxWindow[] {
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [index, name] = line.split("\t");
      return { index: Number.parseInt(index, 10), name };
    });
}

// Per-window names for a session, keyed by index -- see WindowTabs.kt on the
// KMP client for why this exists (real tmux window names must survive a
// page refresh, not just live as client-local optimistic state).
export async function listWindows(name: string, exec: ExecFn = defaultExec): Promise<TmuxWindow[]> {
  if (!isValidSessionName(name)) {
    throw new ValidationError(`Invalid session name: ${name}`);
  }
  const { stdout } = await exec("tmux", ["list-windows", "-t", name, "-F", WINDOW_LIST_FORMAT]);
  return parseWindowList(stdout);
}

export interface CreateSessionOptions {
  cwd?: string;
}

export async function createSession(
  name: string,
  options: CreateSessionOptions = {},
  exec: ExecFn = defaultExec,
): Promise<void> {
  if (!isValidSessionName(name)) {
    throw new ValidationError(`Invalid session name: ${name}`);
  }
  const args = ["new-session", "-d", "-s", name];
  if (options.cwd) args.push("-c", options.cwd);
  await exec("tmux", args);
}

export async function killSession(name: string, exec: ExecFn = defaultExec): Promise<void> {
  if (!isValidSessionName(name)) {
    throw new ValidationError(`Invalid session name: ${name}`);
  }
  await exec("tmux", ["kill-session", "-t", name]);
}

export type ScrollDirection = "up" | "down";

// Whether the session's active pane is currently in a tmux "mode" (copy-mode
// being the one this app cares about). Re-entering copy-mode while already
// in it resets the scroll position back to the bottom, so callers must check
// this before deciding whether to send the `copy-mode` command.
export async function getPaneMode(name: string, exec: ExecFn = defaultExec): Promise<boolean> {
  if (!isValidSessionName(name)) {
    throw new ValidationError(`Invalid session name: ${name}`);
  }
  const { stdout } = await exec("tmux", ["display-message", "-p", "-t", name, "#{pane_in_mode}"]);
  return stdout.trim() === "1";
}

// Drives tmux's own copy-mode scrollback rather than relying on the user's
// tmux.conf having `set -g mouse on` -- see README for why this app owns
// scroll instead of delegating to xterm.js's native (and largely useless,
// since tmux repaints via cursor positioning rather than newlines)
// scrollback. Scrolling up enters copy-mode on demand; scrolling down only
// acts while already in copy-mode (there's nothing to scroll down to
// otherwise -- the pane is already live).
export async function scrollPane(
  name: string,
  direction: ScrollDirection,
  lines: number,
  exec: ExecFn = defaultExec,
): Promise<void> {
  if (!isValidSessionName(name)) {
    throw new ValidationError(`Invalid session name: ${name}`);
  }

  const inMode = await getPaneMode(name, exec);

  if (direction === "up") {
    if (!inMode) await exec("tmux", ["copy-mode", "-t", name]);
    await exec("tmux", ["send-keys", "-X", "-t", name, "-N", String(lines), "scroll-up"]);
    return;
  }

  if (!inMode) return;
  await exec("tmux", ["send-keys", "-X", "-t", name, "-N", String(lines), "scroll-down"]);
}

// Exits copy-mode, snapping the pane back to live output. Called when the
// user resumes typing after scrolling, so keystrokes reach the shell instead
// of being swallowed by copy-mode's own keytable.
export async function cancelCopyMode(name: string, exec: ExecFn = defaultExec): Promise<void> {
  if (!isValidSessionName(name)) {
    throw new ValidationError(`Invalid session name: ${name}`);
  }

  const inMode = await getPaneMode(name, exec);
  if (!inMode) return;
  await exec("tmux", ["send-keys", "-X", "-t", name, "cancel"]);
}
