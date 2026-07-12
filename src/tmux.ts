import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
}

export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string }>;

const SESSION_LIST_FORMAT = "#{session_name}\t#{session_windows}\t#{session_attached}";

// tmux session names may not contain ':' (target separator), must not start
// with '-' (would be parsed as a CLI flag), and are kept free of shell
// metacharacters even though we always invoke tmux via execFile (no shell).
const VALID_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

export function isValidSessionName(name: string): boolean {
  return VALID_NAME_PATTERN.test(name);
}

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

export async function createSession(name: string, exec: ExecFn = defaultExec): Promise<void> {
  if (!isValidSessionName(name)) {
    throw new Error(`Invalid session name: ${name}`);
  }
  await exec("tmux", ["new-session", "-d", "-s", name]);
}

export async function killSession(name: string, exec: ExecFn = defaultExec): Promise<void> {
  if (!isValidSessionName(name)) {
    throw new Error(`Invalid session name: ${name}`);
  }
  await exec("tmux", ["kill-session", "-t", name]);
}
