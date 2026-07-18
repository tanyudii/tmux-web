import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV_DIR_NAME } from "./env-config.ts";

const execFileAsync = promisify(execFileCb);

export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

function defaultExec(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args);
}

export class EnvEditorError extends Error {}
export class EnvFileNotFoundError extends EnvEditorError {}
export class EnvFileValidationError extends EnvEditorError {}

// The only files this editor will read or write -- deliberately a fixed
// allowlist (not "any file under .tmux-web-env/") so there's no path- or
// filename-based attack surface to reason about. Mirrors the same four
// filenames env-config.ts already knows how to load.
export const EDITABLE_ENV_FILES = ["docker-compose.yml", "pre-run.sh", "post-run.sh", "env.json"] as const;
export type EditableEnvFile = (typeof EDITABLE_ENV_FILES)[number];

export interface EnvFileEntry {
  filename: EditableEnvFile;
  content: string;
}

function isEditableEnvFile(filename: string): filename is EditableEnvFile {
  return (EDITABLE_ENV_FILES as readonly string[]).includes(filename);
}

function envDirFor(worktreePath: string): string {
  return join(worktreePath, ENV_DIR_NAME);
}

/** Lists every editable file that currently exists (a project need not have all four). */
export async function listEnvFiles(worktreePath: string, exec: ExecFn = defaultExec): Promise<EnvFileEntry[]> {
  void exec; // unused here, kept for signature symmetry with readEnvFile/writeEnvFile
  const dir = envDirFor(worktreePath);
  const entries: EnvFileEntry[] = [];
  for (const filename of EDITABLE_ENV_FILES) {
    try {
      const content = await readFile(join(dir, filename), "utf-8");
      entries.push({ filename, content });
    } catch {
      // File doesn't exist for this project -- not every project uses pre-run.sh/post-run.sh/env.json.
    }
  }
  return entries;
}

export async function readEnvFile(worktreePath: string, filename: string): Promise<string> {
  if (!isEditableEnvFile(filename)) {
    throw new EnvEditorError(`Not an editable environment file: ${filename}`);
  }
  try {
    return await readFile(join(envDirFor(worktreePath), filename), "utf-8");
  } catch {
    throw new EnvFileNotFoundError(`${filename} does not exist for this session`);
  }
}

// Validates a docker-compose.yml by asking the real `docker compose` binary
// to parse it -- not a hand-rolled YAML parser (this project adds no new
// npm dependencies for this, matching its existing "shell out to the real
// tool" pattern for git/tmux/docker elsewhere). `config --quiet` fully
// resolves the file (interpolation, merges, schema) and exits non-zero with
// a human-readable reason on anything invalid.
async function validateComposeFile(path: string, exec: ExecFn): Promise<void> {
  try {
    await exec("docker", ["compose", "-f", path, "config", "--quiet"]);
  } catch (error) {
    const stderr = (error as { stderr?: string })?.stderr ?? "";
    throw new EnvFileValidationError(stderr.trim() || (error instanceof Error ? error.message : String(error)));
  }
}

// `sh -n` parses the script and reports syntax errors without executing it
// -- the same shell run-script.ts already uses to actually run these
// scripts, so a file that passes this check is guaranteed parseable by the
// real interpreter that will later run it.
async function validateShellScript(path: string, exec: ExecFn): Promise<void> {
  try {
    await exec("/bin/sh", ["-n", path]);
  } catch (error) {
    const stderr = (error as { stderr?: string })?.stderr ?? "";
    throw new EnvFileValidationError(stderr.trim() || (error instanceof Error ? error.message : String(error)));
  }
}

function validateJsonFile(content: string): void {
  try {
    JSON.parse(content);
  } catch (error) {
    throw new EnvFileValidationError(
      `Malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Validates then writes an editable `.tmux-web-env/` file -- EMB-210.
 * Validation always runs against a throwaway temp copy first, and the real
 * file is only overwritten (via an atomic rename) once that passes, so a
 * bad edit can never leave a project's environment config half-written or
 * corrupted mid-save.
 */
export async function writeEnvFile(
  worktreePath: string,
  filename: string,
  content: string,
  exec: ExecFn = defaultExec,
): Promise<void> {
  if (!isEditableEnvFile(filename)) {
    throw new EnvEditorError(`Not an editable environment file: ${filename}`);
  }

  if (filename === "env.json") {
    validateJsonFile(content);
  } else {
    const tempDir = await mkdtemp(join(tmpdir(), "tmux-web-env-validate-"));
    try {
      const tempPath = join(tempDir, filename);
      await writeFile(tempPath, content, "utf-8");
      if (filename === "docker-compose.yml") {
        await validateComposeFile(tempPath, exec);
      } else {
        await validateShellScript(tempPath, exec);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  const dir = envDirFor(worktreePath);
  const finalPath = join(dir, filename);
  const stagingPath = `${finalPath}.tmp-${Date.now()}`;
  await writeFile(stagingPath, content, "utf-8");
  await rename(stagingPath, finalPath);
}
