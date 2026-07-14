import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { defaultAppDir } from "./app-dir.ts";

const execFileAsync = promisify(execFileCb);

export type ExecFn = (
  file: string,
  args: string[],
  options?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

export function defaultExec(
  file: string,
  args: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, { encoding: "utf8", cwd: options?.cwd });
}

export class UpgradeError extends Error {}

const REPO_SSH_URL = "git@github.com:tanyudii/tmux-web";
const SERVICE_NAME = "tmux-web";

function messageOf(error: unknown): string {
  const stderr = (error as { stderr?: string })?.stderr;
  if (stderr) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}

function normalizeGitUrl(url: string): string {
  return url.trim().replace(/\.git$/, "");
}

// `git ls-remote --tags` lists an extra "<tag>^{}" line for every annotated
// tag (the peeled commit it points at); strip that suffix so it doesn't
// look like a distinct, newer-sorting tag name.
export function parseLatestTag(lsRemoteOutput: string): string | null {
  const names = lsRemoteOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\t")[1] ?? "")
    .filter((ref) => ref.startsWith("refs/tags/"))
    .map((ref) => ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, ""));
  return names[0] ?? null;
}

export interface UpgradeDeps {
  exec?: ExecFn;
  repoUrl?: string;
  appDir?: string;
  mkdirRecursive?: (path: string) => Promise<unknown>;
}

interface ResolvedUpgradeDeps {
  exec: ExecFn;
  repoUrl: string;
  appDir: string;
  mkdirRecursive: (path: string) => Promise<unknown>;
}

function resolveUpgradeDeps(deps: UpgradeDeps): ResolvedUpgradeDeps {
  return {
    exec: deps.exec ?? defaultExec,
    repoUrl: deps.repoUrl ?? REPO_SSH_URL,
    appDir: deps.appDir ?? defaultAppDir(),
    mkdirRecursive: deps.mkdirRecursive ?? ((path) => mkdir(path, { recursive: true })),
  };
}

export async function resolveLatestTag(deps: UpgradeDeps = {}): Promise<string> {
  const { exec, repoUrl } = resolveUpgradeDeps(deps);

  let stdout: string;
  try {
    ({ stdout } = await exec("git", ["ls-remote", "--sort=-v:refname", "--tags", repoUrl]));
  } catch (error) {
    throw new UpgradeError(`Failed to list tags from ${repoUrl}: ${messageOf(error)}`);
  }

  const tag = parseLatestTag(stdout);
  if (!tag) {
    throw new UpgradeError(`No tags found on ${repoUrl}`);
  }
  return tag;
}

async function isServiceActive(exec: ExecFn): Promise<boolean> {
  try {
    const { stdout } = await exec("systemctl", ["--user", "is-active", SERVICE_NAME]);
    return stdout.trim() === "active";
  } catch {
    return false;
  }
}

// Detects whether `appDir` is already a git clone of `repoUrl`. Throws
// (rather than returning false) when it's a git repo pointed at something
// ELSE -- that means appDir is an unrelated directory that happens to be a
// git repo, and silently re-cloning over it would destroy whatever it is.
async function isExistingAppClone(exec: ExecFn, appDir: string, repoUrl: string): Promise<boolean> {
  try {
    await exec("git", ["-C", appDir, "rev-parse", "--is-inside-work-tree"]);
  } catch {
    return false;
  }

  let originUrl = "";
  try {
    ({ stdout: originUrl } = await exec("git", ["-C", appDir, "remote", "get-url", "origin"]));
  } catch {
    originUrl = "";
  }
  originUrl = originUrl.trim();

  // Normalize a trailing ".git" before comparing -- `git clone
  // ...tmux-web.git` and `git clone ...tmux-web` (no suffix) both point at
  // the same repo, and both forms are in common use (the README's own
  // bootstrap command uses the ".git" form).
  if (normalizeGitUrl(originUrl) !== normalizeGitUrl(repoUrl)) {
    throw new UpgradeError(
      `${appDir} exists and is a git repo, but its origin remote (${originUrl || "<none>"}) does not match ` +
        `${repoUrl}. Refusing to overwrite -- move ${appDir} aside and re-run if this is unrelated.`,
    );
  }
  return true;
}

// Installs or updates tmux-web's own code at `appDir`, a location kept
// deliberately OUTSIDE any node_modules directory (see app-dir.ts) so Node's
// ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING restriction never applies, and
// via a direct git clone/fetch over SSH so the private-repo codeload.github.com
// tarball-shortcut 404 (npm/pacote's `npm install -g github:...` failure
// mode) never comes into play either.
export async function cloneOrUpdateAppDir(
  exec: ExecFn,
  appDir: string,
  repoUrl: string,
  tag: string,
  mkdirRecursive: (path: string) => Promise<unknown> = (path) => mkdir(path, { recursive: true }),
): Promise<void> {
  const existing = await isExistingAppClone(exec, appDir, repoUrl);

  if (existing) {
    try {
      // Fetch exactly this tag's commit rather than `fetch --tags` -- on a
      // shallow (--depth 1) clone, fetching every tag ref can leave a
      // dangling ref outside the fetched history and make checkout fail
      // opaquely. `--force` on both commands makes this self-healing even
      // if appDir's local state drifted (appDir is code-only, never user
      // data, so discarding local changes here is intentional).
      await exec("git", ["-C", appDir, "fetch", "--depth", "1", "--force", "origin", "tag", tag]);
      await exec("git", ["-C", appDir, "checkout", "--force", tag]);
    } catch (error) {
      throw new UpgradeError(
        `Failed to update ${appDir} to ${tag}: ${messageOf(error)}. If ${appDir} looks corrupted ` +
          `(e.g. from a killed previous upgrade), remove it and re-run.`,
      );
    }
    return;
  }

  await mkdirRecursive(dirname(appDir));
  try {
    await exec("git", ["clone", "--branch", tag, "--depth", "1", repoUrl, appDir]);
  } catch (error) {
    throw new UpgradeError(
      `Failed to clone ${repoUrl} into ${appDir}: ${messageOf(error)}. If ${appDir} is left over from ` +
        `a previous failed install, remove it and re-run.`,
    );
  }
}

export async function npmInstallAndLink(exec: ExecFn, appDir: string): Promise<void> {
  try {
    await exec("npm", ["ci", "--omit=dev"], { cwd: appDir });
  } catch (error) {
    throw new UpgradeError(`npm ci --omit=dev failed in ${appDir}: ${messageOf(error)}`);
  }

  try {
    await exec("npm", ["link"], { cwd: appDir });
  } catch (error) {
    throw new UpgradeError(
      `npm link failed in ${appDir}: ${messageOf(error)}. If a global tmuxweb binary already exists ` +
        `and isn't an npm-managed symlink, remove it and re-run (e.g. rm "$(npm prefix -g)/bin/tmuxweb").`,
    );
  }
}

export async function runUpgrade(args: string[], deps: UpgradeDeps = {}): Promise<void> {
  const tagFlagIndex = args.indexOf("--tag");
  const explicitTag = tagFlagIndex !== -1 ? args[tagFlagIndex + 1] : undefined;
  if (tagFlagIndex !== -1 && !explicitTag) {
    throw new UpgradeError("Usage: tmuxweb upgrade [--tag <tag>] [--app-dir <path>]");
  }

  const appDirFlagIndex = args.indexOf("--app-dir");
  const explicitAppDir = appDirFlagIndex !== -1 ? args[appDirFlagIndex + 1] : undefined;
  if (appDirFlagIndex !== -1 && !explicitAppDir) {
    throw new UpgradeError("Usage: tmuxweb upgrade [--tag <tag>] [--app-dir <path>]");
  }

  const { exec, repoUrl, appDir, mkdirRecursive } = resolveUpgradeDeps({
    ...deps,
    appDir: explicitAppDir ?? deps.appDir,
  });

  const tag = explicitTag ?? (await resolveLatestTag({ exec, repoUrl }));
  console.log(`Upgrading to ${tag}...`);

  await cloneOrUpdateAppDir(exec, appDir, repoUrl, tag, mkdirRecursive);
  await npmInstallAndLink(exec, appDir);
  console.log(`Installed ${tag} at ${appDir}.`);

  if (await isServiceActive(exec)) {
    console.log("Restarting the tmux-web service...");
    try {
      await exec("systemctl", ["--user", "restart", SERVICE_NAME]);
      console.log("Service restarted.");
    } catch (error) {
      console.warn(`Could not restart the service automatically: ${messageOf(error)}`);
      console.warn(`Restart it yourself: systemctl --user restart ${SERVICE_NAME}`);
    }
  } else {
    console.log("tmux-web service is not currently running -- nothing to restart.");
  }
}
