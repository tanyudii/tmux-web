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

// EMB-220 session templates: types `text` into the session's active pane
// followed by Enter, as if the user had typed it themselves right after the
// session was created -- used for a template's optional startup command.
// Passed as a single execFile argv element (never through a shell), so
// there's no injection risk despite `text` being arbitrary user input; tmux
// itself interprets it as literal keys, not a shell command line.
export async function sendKeysToSession(name: string, text: string, exec: ExecFn = defaultExec): Promise<void> {
  if (!isValidSessionName(name)) {
    throw new ValidationError(`Invalid session name: ${name}`);
  }
  await exec("tmux", ["send-keys", "-t", name, text, "Enter"]);
}

// EMB-217 split-pane: creates `name` as a tmux *linked session* onto
// `sourceName` (`tmux new-session -t <sourceName> -s <name>`) if it doesn't
// already exist -- confirmed live that this shares the source's windows
// and panes exactly (same content/processes) while giving `name` its own
// independent current-window pointer, which is what lets a split viewport
// show a different window than the primary session. Idempotent: `has-session`
// probes first so re-opening an already-open split reattaches to the same
// linked session (and whatever window it was last showing) instead of
// resetting it back to window 0.
export async function ensureLinkedSession(
  name: string,
  sourceName: string,
  exec: ExecFn = defaultExec,
): Promise<void> {
  if (!isValidSessionName(name) || !isValidSessionName(sourceName)) {
    throw new ValidationError(`Invalid session name: ${name} / ${sourceName}`);
  }
  try {
    await exec("tmux", ["has-session", "-t", name]);
    return;
  } catch {
    // Doesn't exist yet -- fall through and create it.
  }
  await exec("tmux", ["new-session", "-d", "-t", sourceName, "-s", name]);
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

// Wires this session's `alert-bell` hook (confirmed live: NOT "bell" -- that
// hook name doesn't exist in tmux, "unknown value" is what tmux 3.6 returns
// for it) so a BEL byte reaches the backend's /internal/bell endpoint (see
// server.ts + push-notifications.ts) even when no browser tab has this
// session's terminal open. This fires from tmux's own bell-monitoring
// (monitor-bell, on by default), which runs independently of any attached
// client -- unlike the WS-relayed PTY stream in pty-bridge.ts, which only
// exists while a tab is actually attached. Confirmed live with a real tmux
// session + a real HTTP listener + `tmux send-keys ... printf '\a'` with no
// client ever attached.
//
// Re-set (not appended) on every call -- session-scoped hooks in tmux
// replace rather than accumulate, so calling this again after a server
// restart on a different port self-heals instead of leaving a stale port
// number behind. `-b` runs curl in the background so a slow/unreachable
// backend never blocks tmux itself; output is discarded since nothing reads
// it. `name` is validated above and `port` is always a number, so the
// embedded command string is safe from shell-metacharacter injection
// despite tmux itself re-parsing it as a shell command via `/bin/sh -c`.
export async function setBellHook(name: string, port: number, exec: ExecFn = defaultExec): Promise<void> {
  if (!isValidSessionName(name)) {
    throw new ValidationError(`Invalid session name: ${name}`);
  }
  const command = `curl -fsS -m 3 -X POST "http://127.0.0.1:${port}/internal/bell?session=${name}" >/dev/null 2>&1`;
  await exec("tmux", ["set-hook", "-t", name, "alert-bell", `run-shell -b '${command}'`]);
}
