import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export class EnvConfigError extends Error {}

export interface OpenLinkConfig {
  label: string;
  service: string;
  port: number;
}

export interface EnvConfig {
  composeFile: string;
  preRunScript: string | null;
  postRunScript: string | null;
  openLinks: OpenLinkConfig[];
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

function parseOpenLinkEntry(entry: unknown, index: number): OpenLinkConfig {
  const item = (entry ?? {}) as { label?: unknown; service?: unknown; port?: unknown };

  if (typeof item.service !== "string" || item.service.length === 0) {
    throw new EnvConfigError(`${MANIFEST_FILENAME}: open[${index}].service must be a non-empty string`);
  }
  if (typeof item.port !== "number" || !Number.isInteger(item.port)) {
    throw new EnvConfigError(`${MANIFEST_FILENAME}: open[${index}].port must be an integer`);
  }
  if (item.label !== undefined && typeof item.label !== "string") {
    throw new EnvConfigError(`${MANIFEST_FILENAME}: open[${index}].label must be a string`);
  }

  return { label: (item.label as string | undefined) ?? item.service, service: item.service, port: item.port };
}

// The legacy single-link shape (openService/openPort) is still read so
// existing .tmux-web-env/env.json files in other projects keep working
// without a migration -- see loadManifest below for the precedence rule
// between this and the newer open[] array.
function parseLegacyOpenLink(manifest: {
  openService?: unknown;
  openPort?: unknown;
}): OpenLinkConfig[] {
  if (manifest.openService !== undefined && typeof manifest.openService !== "string") {
    throw new EnvConfigError(`${MANIFEST_FILENAME}: openService must be a string`);
  }
  if (
    manifest.openPort !== undefined &&
    (typeof manifest.openPort !== "number" || !Number.isInteger(manifest.openPort))
  ) {
    throw new EnvConfigError(`${MANIFEST_FILENAME}: openPort must be an integer`);
  }

  if (typeof manifest.openService !== "string" || typeof manifest.openPort !== "number") return [];
  return [{ label: "Open", service: manifest.openService, port: manifest.openPort }];
}

interface EnvManifest {
  openLinks: OpenLinkConfig[];
}

async function loadManifest(manifestPath: string): Promise<EnvManifest> {
  if (!(await fileExists(manifestPath))) {
    return { openLinks: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf-8"));
  } catch (error) {
    throw new EnvConfigError(
      `Malformed ${MANIFEST_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const manifest = (parsed ?? {}) as { open?: unknown; openService?: unknown; openPort?: unknown };

  // open[] takes precedence over the legacy singular fields when both are
  // present -- still validate the legacy fields either way, so a stray
  // wrong-typed openService/openPort is caught rather than silently ignored.
  const legacyLinks = parseLegacyOpenLink(manifest);

  if (manifest.open === undefined) {
    return { openLinks: legacyLinks };
  }
  if (!Array.isArray(manifest.open)) {
    throw new EnvConfigError(`${MANIFEST_FILENAME}: open must be an array`);
  }

  return { openLinks: manifest.open.map((entry, index) => parseOpenLinkEntry(entry, index)) };
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
    openLinks: manifest.openLinks,
  };
}
