import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export class EnvConfigError extends Error {}

export interface EnvConfig {
  composeFile: string;
  preRunScript: string | null;
  postRunScript: string | null;
  openService: string | null;
  openPort: number | null;
}

// Convention directory read from inside a project's worktree -- distinct
// from tmux-web's own ~/.tmux-web data dir, which lives on the host and
// never inside a managed repo.
export const ENV_DIR_NAME = ".tmux-web-env";
const COMPOSE_FILENAME = "docker-compose.yml";
const PRE_RUN_FILENAME = "pre-run.sh";
const POST_RUN_FILENAME = "post-run.sh";
const MANIFEST_FILENAME = "env.json";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface EnvManifest {
  openService: string | null;
  openPort: number | null;
}

async function loadManifest(manifestPath: string): Promise<EnvManifest> {
  if (!(await fileExists(manifestPath))) {
    return { openService: null, openPort: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf-8"));
  } catch (error) {
    throw new EnvConfigError(
      `Malformed ${MANIFEST_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const manifest = (parsed ?? {}) as { openService?: unknown; openPort?: unknown };

  if (manifest.openService !== undefined && typeof manifest.openService !== "string") {
    throw new EnvConfigError(`${MANIFEST_FILENAME}: openService must be a string`);
  }
  if (
    manifest.openPort !== undefined &&
    (typeof manifest.openPort !== "number" || !Number.isInteger(manifest.openPort))
  ) {
    throw new EnvConfigError(`${MANIFEST_FILENAME}: openPort must be an integer`);
  }

  return {
    openService: (manifest.openService as string | undefined) ?? null,
    openPort: (manifest.openPort as number | undefined) ?? null,
  };
}

// Reads the opt-in `.tmux-web-env/` convention from a session's worktree.
// Returns null when the project hasn't opted in (no docker-compose.yml),
// so the environment feature stays invisible for repos that don't use it.
export async function loadEnvConfig(worktreePath: string): Promise<EnvConfig | null> {
  const envDir = join(worktreePath, ENV_DIR_NAME);
  const composeFile = join(envDir, COMPOSE_FILENAME);
  if (!(await fileExists(composeFile))) return null;

  const preRunScript = join(envDir, PRE_RUN_FILENAME);
  const postRunScript = join(envDir, POST_RUN_FILENAME);
  const manifest = await loadManifest(join(envDir, MANIFEST_FILENAME));

  return {
    composeFile,
    preRunScript: (await fileExists(preRunScript)) ? preRunScript : null,
    postRunScript: (await fileExists(postRunScript)) ? postRunScript : null,
    openService: manifest.openService,
    openPort: manifest.openPort,
  };
}
