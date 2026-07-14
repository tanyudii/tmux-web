import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

function defaultExec(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args);
}

export class UpgradeError extends Error {}

const REPO_SSH_URL = "git@github.com:tanyudii/tmux-web";
const GITHUB_SLUG = "tanyudii/tmux-web";
const SERVICE_NAME = "tmux-web";

function messageOf(error: unknown): string {
  const stderr = (error as { stderr?: string })?.stderr;
  if (stderr) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
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
  githubSlug?: string;
}

interface ResolvedUpgradeDeps {
  exec: ExecFn;
  repoUrl: string;
  githubSlug: string;
}

function resolveUpgradeDeps(deps: UpgradeDeps): ResolvedUpgradeDeps {
  return {
    exec: deps.exec ?? defaultExec,
    repoUrl: deps.repoUrl ?? REPO_SSH_URL,
    githubSlug: deps.githubSlug ?? GITHUB_SLUG,
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

export async function runUpgrade(args: string[], deps: UpgradeDeps = {}): Promise<void> {
  const { exec, repoUrl, githubSlug } = resolveUpgradeDeps(deps);

  const tagFlagIndex = args.indexOf("--tag");
  const explicitTag = tagFlagIndex !== -1 ? args[tagFlagIndex + 1] : undefined;
  if (tagFlagIndex !== -1 && !explicitTag) {
    throw new UpgradeError("Usage: tmuxweb upgrade [--tag <tag>]");
  }

  const tag = explicitTag ?? (await resolveLatestTag({ exec, repoUrl }));
  console.log(`Upgrading to ${tag}...`);

  try {
    await exec("npm", ["install", "-g", `github:${githubSlug}#${tag}`]);
  } catch (error) {
    throw new UpgradeError(`npm install -g failed: ${messageOf(error)}`);
  }
  console.log(`Installed ${tag}.`);

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
