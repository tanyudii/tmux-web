import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export type ExecFn = (
  file: string,
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

function defaultExec(
  file: string,
  args: string[],
  options: { cwd: string },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, options);
}

export class ScriptError extends Error {}

export interface RunScriptResult {
  stdout: string;
  stderr: string;
}

// Runs a pre-run/post-run script through /bin/sh rather than executing the
// file directly, so it works whether or not the user remembered to chmod
// +x it in the repo.
export async function runScript(
  scriptPath: string,
  cwd: string,
  exec: ExecFn = defaultExec,
): Promise<RunScriptResult> {
  try {
    return await exec("/bin/sh", [scriptPath], { cwd });
  } catch (error) {
    const stderr = (error as { stderr?: string })?.stderr ?? "";
    const message = stderr.trim() || (error instanceof Error ? error.message : String(error));
    throw new ScriptError(message);
  }
}
