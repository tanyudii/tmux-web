import { execFile as execFileCb, spawn as spawnCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultAppDir } from "./app-dir.ts";
import { installService } from "./service-command.ts";

const execFileAsync = promisify(execFileCb);

// Guards runUpgrade's re-exec (see below) against looping forever: set only
// on the re-exec'd child's own env, never inherited from a normal shell.
const REEXEC_ENV_FLAG = "TMUX_WEB_UPGRADE_REEXEC";

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

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<number>;

// stdio: "inherit" (not execFile's captured-output model) so the re-exec'd
// child's own console.log/warn output streams straight to the terminal the
// user is watching, in real time, exactly like a normal CLI invocation --
// not buffered and dumped only after the child exits.
export function defaultSpawn(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawnCb(command, args, { stdio: "inherit", cwd: options.cwd, env: options.env });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export class UpgradeError extends Error {}

const REPO_SSH_URL = "git@github.com:tanyudii/tmux-web";
// `gh --repo` wants "owner/repo", not the SSH remote form above -- gh's own
// auth (gh auth login / GH_TOKEN) is a separate credential from the SSH
// deploy key used for git, so this is a deliberate second identity for the
// same repo, not duplication.
const REPO_SLUG = "tanyudii/tmux-web";
const SERVICE_NAME = "tmux-web";
// Fixed name, not tag-suffixed -- `gh release download <tag>` already scopes
// the download to one release, so the asset itself doesn't need the version
// baked into its filename. Must match what release.yml's "Package the web
// build for the release" step produces.
const WEB_BUILD_ASSET_NAME = "web-dist.tar.gz";

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
  repoSlug?: string;
  appDir?: string;
  mkdirRecursive?: (path: string) => Promise<unknown>;
  mkdtemp?: (prefix: string) => Promise<string>;
  rmRecursive?: (path: string) => Promise<unknown>;
  refreshService?: (deps: { exec: ExecFn }) => Promise<void>;
  spawn?: SpawnFn;
  /** True when this process IS the re-exec'd child (see runUpgrade) -- defaults to reading the guard env var. */
  isReexecChild?: boolean;
}

interface ResolvedUpgradeDeps {
  exec: ExecFn;
  repoUrl: string;
  repoSlug: string;
  appDir: string;
  mkdirRecursive: (path: string) => Promise<unknown>;
  mkdtemp: (prefix: string) => Promise<string>;
  rmRecursive: (path: string) => Promise<unknown>;
  refreshService: (deps: { exec: ExecFn }) => Promise<void>;
  spawn: SpawnFn;
  isReexecChild: boolean;
}

function resolveUpgradeDeps(deps: UpgradeDeps): ResolvedUpgradeDeps {
  return {
    exec: deps.exec ?? defaultExec,
    repoUrl: deps.repoUrl ?? REPO_SSH_URL,
    repoSlug: deps.repoSlug ?? REPO_SLUG,
    appDir: deps.appDir ?? defaultAppDir(),
    mkdirRecursive: deps.mkdirRecursive ?? ((path) => mkdir(path, { recursive: true })),
    mkdtemp: deps.mkdtemp ?? ((prefix) => mkdtemp(join(tmpdir(), prefix))),
    rmRecursive: deps.rmRecursive ?? ((path) => rm(path, { recursive: true, force: true })),
    refreshService: deps.refreshService ?? installService,
    spawn: deps.spawn ?? defaultSpawn,
    isReexecChild: deps.isReexecChild ?? process.env[REEXEC_ENV_FLAG] === "1",
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

// Downloads this tag's prebuilt SolidJS PWA web client bundle from a GitHub
// Release asset (built + attached by release.yml) and extracts it into the
// exact path src/main.ts's DEFAULT_WEB_BUILD_DIR reads from. That path is
// duplicated here rather than imported from main.ts on purpose -- main.ts
// resolves it relative to its own import.meta.url as a *runtime* concern,
// this is a *deploy* concern with a different caller; if you change one,
// change the other (see CLAUDE.md).
//
// Auth is entirely `gh`'s problem (gh auth login / GH_TOKEN on the server --
// see README's "Requirements on the host machine"), matching how SSH auth
// for cloneOrUpdateAppDir's git calls is the server operator's problem too.
// Callers decide whether a failure here is fatal -- see runUpgrade, which
// treats it as non-fatal so a missing/misconfigured `gh` still leaves a
// working, API-only server (src/web-build.ts's existing graceful-degrade
// path) rather than blocking the rest of the upgrade.
export async function downloadWebBuild(
  exec: ExecFn,
  appDir: string,
  tag: string,
  repoSlug: string,
  mkdirRecursive: (path: string) => Promise<unknown> = (path) => mkdir(path, { recursive: true }),
  mkdtempFn: (prefix: string) => Promise<string> = (prefix) => mkdtemp(join(tmpdir(), prefix)),
  rmRecursiveFn: (path: string) => Promise<unknown> = (path) => rm(path, { recursive: true, force: true }),
): Promise<void> {
  const downloadDir = await mkdtempFn("tmux-web-web-dist-");
  try {
    try {
      await exec("gh", [
        "release",
        "download",
        tag,
        "--repo",
        repoSlug,
        "--pattern",
        WEB_BUILD_ASSET_NAME,
        "--dir",
        downloadDir,
        "--clobber",
      ]);
    } catch (error) {
      throw new UpgradeError(
        `gh release download failed for ${tag} (asset ${WEB_BUILD_ASSET_NAME}) from ${repoSlug}: ` +
          `${messageOf(error)}. Make sure the gh CLI is installed and authenticated (gh auth login, or ` +
          `set GH_TOKEN) -- see README's "Requirements on the host machine".`,
      );
    }

    const targetDir = join(appDir, "web", "dist");
    await mkdirRecursive(targetDir);

    try {
      await exec("tar", ["-xzf", join(downloadDir, WEB_BUILD_ASSET_NAME), "-C", targetDir]);
    } catch (error) {
      throw new UpgradeError(`Failed to extract ${WEB_BUILD_ASSET_NAME} into ${targetDir}: ${messageOf(error)}`);
    }
  } finally {
    await rmRecursiveFn(downloadDir);
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

  const {
    exec,
    repoUrl,
    repoSlug,
    appDir,
    mkdirRecursive,
    mkdtemp: mkdtempDep,
    rmRecursive,
    refreshService,
    spawn,
    isReexecChild,
  } = resolveUpgradeDeps({
    ...deps,
    appDir: explicitAppDir ?? deps.appDir,
  });

  const tag = explicitTag ?? (await resolveLatestTag({ exec, repoUrl }));
  console.log(`Upgrading to ${tag}...`);

  await cloneOrUpdateAppDir(exec, appDir, repoUrl, tag, mkdirRecursive);
  await npmInstallAndLink(exec, appDir);
  console.log(`Installed ${tag} at ${appDir}.`);

  if (!isReexecChild) {
    // The files on disk are now the new version, but THIS process is still
    // running the old upgrade.ts that was already loaded into memory when
    // it started -- Node can't hot-reload an already-imported module, so
    // finishing the upgrade in-process would silently run stale logic (see
    // CLAUDE.md's "a running tmuxweb upgrade process can't apply its own
    // code changes"). Re-exec into the freshly-installed bin/tmuxweb.ts
    // instead: a brand new process loads it fresh from disk, so the rest of
    // the upgrade (web build download, service refresh) always runs the
    // code that was just installed, in a single `tmuxweb upgrade` call.
    const binPath = join(appDir, "bin", "tmuxweb.ts");
    const reexecArgs = ["--experimental-strip-types", binPath, "upgrade", "--tag", tag, "--app-dir", appDir];
    const exitCode = await spawn(process.execPath, reexecArgs, {
      cwd: appDir,
      env: { ...process.env, [REEXEC_ENV_FLAG]: "1" },
    });
    if (exitCode !== 0) {
      throw new UpgradeError(`Re-exec into the updated tmux-web code failed (exit code ${exitCode}).`);
    }
    return;
  }

  console.log("Downloading the web UI build...");
  try {
    await downloadWebBuild(exec, appDir, tag, repoSlug, mkdirRecursive, mkdtempDep, rmRecursive);
    console.log("Web UI build installed.");
  } catch (error) {
    console.warn(`Could not download the web UI build: ${messageOf(error)}`);
    console.warn(
      "tmux-web will still serve the API; the web UI stays unavailable until the next successful upgrade.",
    );
  }

  if (await isServiceActive(exec)) {
    // Re-write the systemd unit before restarting, not just restart in
    // place -- what ExecStart needs to look like can change between
    // versions (it did, going into v1.1.0), and a stale unit file would
    // otherwise silently stop running the actual server on restart.
    console.log("Refreshing the systemd service definition...");
    try {
      await refreshService({ exec });
    } catch (error) {
      console.warn(`Could not refresh the systemd service definition: ${messageOf(error)}`);
    }

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
