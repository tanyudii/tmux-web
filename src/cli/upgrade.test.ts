import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  UpgradeError,
  parseLatestTag,
  resolveLatestTag,
  runUpgrade,
  cloneOrUpdateAppDir,
  npmInstallAndLink,
  defaultExec,
} from "./upgrade.ts";
import type { ExecFn } from "./upgrade.ts";

const execFileAsync = promisify(execFileCb);

function recordingExec(
  handlers: Record<string, (args: string[]) => { stdout: string; stderr: string }>,
): { exec: ExecFn; calls: string[] } {
  const calls: string[] = [];
  const exec: ExecFn = async (file, args, options) => {
    const cwdSuffix = options?.cwd ? ` (cwd=${options.cwd})` : "";
    calls.push(`${file} ${args.join(" ")}${cwdSuffix}`);
    const handler = handlers[file];
    if (!handler) throw new Error(`no handler for ${file}`);
    return handler(args);
  };
  return { exec, calls };
}

const noopMkdir = async (): Promise<void> => {};

const LS_REMOTE_OUTPUT = [
  "abc123\trefs/tags/v1.3.0",
  "def456\trefs/tags/v1.3.0^{}",
  "ghi789\trefs/tags/v1.2.0",
  "jkl012\trefs/tags/v1.2.0^{}",
].join("\n");

test("parseLatestTag returns the first tag name, ignoring peeled ^{} refs", () => {
  assert.equal(parseLatestTag(LS_REMOTE_OUTPUT), "v1.3.0");
});

test("parseLatestTag returns null when there are no tags", () => {
  assert.equal(parseLatestTag(""), null);
});

test("resolveLatestTag resolves the newest tag via git ls-remote --sort=-v:refname", async () => {
  const { exec, calls } = recordingExec({ git: () => ({ stdout: LS_REMOTE_OUTPUT, stderr: "" }) });
  const tag = await resolveLatestTag({ exec });
  assert.equal(tag, "v1.3.0");
  assert.deepEqual(calls, ["git ls-remote --sort=-v:refname --tags git@github.com:tanyudii/tmux-web"]);
});

test("resolveLatestTag throws UpgradeError when the repo has no tags", async () => {
  const { exec } = recordingExec({ git: () => ({ stdout: "", stderr: "" }) });
  await assert.rejects(() => resolveLatestTag({ exec }), UpgradeError);
});

test("runUpgrade clones fresh when appDir is not an existing git repo", async () => {
  const appDir = "/fake/app/dir";
  const { exec, calls } = recordingExec({
    git: (args) => {
      if (args.includes("rev-parse")) throw new Error("fatal: not a git repository");
      return { stdout: "", stderr: "" };
    },
    npm: () => ({ stdout: "", stderr: "" }),
    systemctl: (args) => (args.includes("is-active") ? { stdout: "inactive", stderr: "" } : { stdout: "", stderr: "" }),
  });

  await runUpgrade(["--tag", "v1.0.0"], { exec, appDir, mkdirRecursive: noopMkdir });

  assert.deepEqual(calls, [
    `git -C ${appDir} rev-parse --is-inside-work-tree`,
    `git clone --branch v1.0.0 --depth 1 git@github.com:tanyudii/tmux-web ${appDir}`,
    `npm ci --omit=dev (cwd=${appDir})`,
    `npm link (cwd=${appDir})`,
    "systemctl --user is-active tmux-web",
  ]);
});

test("runUpgrade installs the explicitly requested tag without calling git ls-remote", async () => {
  const appDir = "/existing/app/dir";
  const { exec, calls } = recordingExec({
    git: (args) => {
      if (args.includes("rev-parse")) return { stdout: "true", stderr: "" };
      if (args.includes("get-url")) return { stdout: "git@github.com:tanyudii/tmux-web\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    npm: () => ({ stdout: "", stderr: "" }),
    systemctl: (args) => (args.includes("is-active") ? { stdout: "inactive", stderr: "" } : { stdout: "", stderr: "" }),
  });

  await runUpgrade(["--tag", "v1.0.0"], { exec, appDir });

  assert.deepEqual(calls, [
    `git -C ${appDir} rev-parse --is-inside-work-tree`,
    `git -C ${appDir} remote get-url origin`,
    `git -C ${appDir} fetch --depth 1 --force origin tag v1.0.0`,
    `git -C ${appDir} checkout --force v1.0.0`,
    `npm ci --omit=dev (cwd=${appDir})`,
    `npm link (cwd=${appDir})`,
    "systemctl --user is-active tmux-web",
  ]);
});

test("runUpgrade resolves the latest tag when --tag is omitted", async () => {
  const appDir = "/existing/app/dir";
  const { exec, calls } = recordingExec({
    git: (args) => {
      if (args.includes("ls-remote")) return { stdout: LS_REMOTE_OUTPUT, stderr: "" };
      if (args.includes("rev-parse")) return { stdout: "true", stderr: "" };
      if (args.includes("get-url")) return { stdout: "git@github.com:tanyudii/tmux-web\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    npm: () => ({ stdout: "", stderr: "" }),
    systemctl: (args) => (args.includes("is-active") ? { stdout: "inactive", stderr: "" } : { stdout: "", stderr: "" }),
  });

  await runUpgrade([], { exec, appDir });

  assert.deepEqual(calls, [
    "git ls-remote --sort=-v:refname --tags git@github.com:tanyudii/tmux-web",
    `git -C ${appDir} rev-parse --is-inside-work-tree`,
    `git -C ${appDir} remote get-url origin`,
    `git -C ${appDir} fetch --depth 1 --force origin tag v1.3.0`,
    `git -C ${appDir} checkout --force v1.3.0`,
    `npm ci --omit=dev (cwd=${appDir})`,
    `npm link (cwd=${appDir})`,
    "systemctl --user is-active tmux-web",
  ]);
});

test("runUpgrade fetches and checks out the tag when appDir is already a matching clone (no re-clone)", async () => {
  const appDir = "/existing/app/dir";
  const { exec, calls } = recordingExec({
    git: (args) => {
      if (args.includes("rev-parse")) return { stdout: "true", stderr: "" };
      if (args.includes("get-url")) return { stdout: "git@github.com:tanyudii/tmux-web\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    npm: () => ({ stdout: "", stderr: "" }),
    systemctl: (args) => (args.includes("is-active") ? { stdout: "inactive", stderr: "" } : { stdout: "", stderr: "" }),
  });

  await runUpgrade(["--tag", "v2.0.0"], { exec, appDir });

  assert.ok(!calls.some((c) => c.includes("clone --branch")), "must not re-clone an existing matching checkout");
  assert.deepEqual(calls, [
    `git -C ${appDir} rev-parse --is-inside-work-tree`,
    `git -C ${appDir} remote get-url origin`,
    `git -C ${appDir} fetch --depth 1 --force origin tag v2.0.0`,
    `git -C ${appDir} checkout --force v2.0.0`,
    `npm ci --omit=dev (cwd=${appDir})`,
    `npm link (cwd=${appDir})`,
    "systemctl --user is-active tmux-web",
  ]);
});

test("runUpgrade treats an origin remote with a trailing .git as matching (no re-clone)", async () => {
  const appDir = "/existing/app/dir";
  const { exec, calls } = recordingExec({
    git: (args) => {
      if (args.includes("rev-parse")) return { stdout: "true", stderr: "" };
      if (args.includes("get-url")) return { stdout: "git@github.com:tanyudii/tmux-web.git\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    npm: () => ({ stdout: "", stderr: "" }),
    systemctl: (args) => (args.includes("is-active") ? { stdout: "inactive", stderr: "" } : { stdout: "", stderr: "" }),
  });

  await runUpgrade(["--tag", "v1.0.0"], { exec, appDir });

  assert.ok(!calls.some((c) => c.includes("clone --branch")), "must not re-clone a clone made with a .git-suffixed URL");
  assert.deepEqual(calls, [
    `git -C ${appDir} rev-parse --is-inside-work-tree`,
    `git -C ${appDir} remote get-url origin`,
    `git -C ${appDir} fetch --depth 1 --force origin tag v1.0.0`,
    `git -C ${appDir} checkout --force v1.0.0`,
    `npm ci --omit=dev (cwd=${appDir})`,
    `npm link (cwd=${appDir})`,
    "systemctl --user is-active tmux-web",
  ]);
});

test("runUpgrade refuses to touch appDir when its origin remote doesn't match", async () => {
  const appDir = "/existing/app/dir";
  const { exec, calls } = recordingExec({
    git: (args) => {
      if (args.includes("rev-parse")) return { stdout: "true", stderr: "" };
      if (args.includes("get-url")) return { stdout: "git@github.com:someone-else/other-repo\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  await assert.rejects(() => runUpgrade(["--tag", "v1.0.0"], { exec, appDir }), UpgradeError);
  assert.deepEqual(calls, [
    `git -C ${appDir} rev-parse --is-inside-work-tree`,
    `git -C ${appDir} remote get-url origin`,
  ]);
});

test("runUpgrade wraps a clone failure in UpgradeError", async () => {
  const appDir = "/fake/app/dir";
  const { exec } = recordingExec({
    git: (args) => {
      if (args.includes("rev-parse")) throw new Error("fatal: not a git repository");
      if (args.includes("clone")) {
        const err = new Error("Command failed") as Error & { stderr?: string };
        err.stderr = "fatal: destination path already exists and is not an empty directory.\n";
        throw err;
      }
      return { stdout: "", stderr: "" };
    },
  });

  await assert.rejects(() => runUpgrade(["--tag", "v1.0.0"], { exec, appDir, mkdirRecursive: noopMkdir }), UpgradeError);
});

test("runUpgrade wraps an npm ci failure in UpgradeError", async () => {
  const appDir = "/existing/app/dir";
  const { exec } = recordingExec({
    git: (args) => {
      if (args.includes("rev-parse")) return { stdout: "true", stderr: "" };
      if (args.includes("get-url")) return { stdout: "git@github.com:tanyudii/tmux-web\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    npm: () => {
      throw new Error("network error");
    },
  });

  await assert.rejects(() => runUpgrade(["--tag", "v1.0.0"], { exec, appDir }), UpgradeError);
});

test("runUpgrade wraps an npm link failure in UpgradeError", async () => {
  const appDir = "/existing/app/dir";
  const { exec } = recordingExec({
    git: (args) => {
      if (args.includes("rev-parse")) return { stdout: "true", stderr: "" };
      if (args.includes("get-url")) return { stdout: "git@github.com:tanyudii/tmux-web\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    npm: (args) => {
      if (args.includes("link")) throw new Error("EEXIST: file already exists");
      return { stdout: "", stderr: "" };
    },
  });

  await assert.rejects(() => runUpgrade(["--tag", "v1.0.0"], { exec, appDir }), UpgradeError);
});

test("runUpgrade refreshes the systemd unit and restarts when the service was active before upgrading", async () => {
  const appDir = "/existing/app/dir";
  const { exec, calls } = recordingExec({
    git: (args) => {
      if (args.includes("rev-parse")) return { stdout: "true", stderr: "" };
      if (args.includes("get-url")) return { stdout: "git@github.com:tanyudii/tmux-web\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    npm: () => ({ stdout: "", stderr: "" }),
    systemctl: (args) => (args.includes("is-active") ? { stdout: "active", stderr: "" } : { stdout: "", stderr: "" }),
  });
  let refreshServiceCalled = false;
  const refreshService = async (): Promise<void> => {
    refreshServiceCalled = true;
  };

  await runUpgrade(["--tag", "v1.0.0"], { exec, appDir, refreshService });

  assert.ok(refreshServiceCalled, "refreshService must be called before restarting an active service");
  assert.deepEqual(calls, [
    `git -C ${appDir} rev-parse --is-inside-work-tree`,
    `git -C ${appDir} remote get-url origin`,
    `git -C ${appDir} fetch --depth 1 --force origin tag v1.0.0`,
    `git -C ${appDir} checkout --force v1.0.0`,
    `npm ci --omit=dev (cwd=${appDir})`,
    `npm link (cwd=${appDir})`,
    "systemctl --user is-active tmux-web",
    "systemctl --user restart tmux-web",
  ]);
});

test("runUpgrade does not refresh the systemd unit when the service is not active", async () => {
  const appDir = "/existing/app/dir";
  const { exec } = recordingExec({
    git: (args) => {
      if (args.includes("rev-parse")) return { stdout: "true", stderr: "" };
      if (args.includes("get-url")) return { stdout: "git@github.com:tanyudii/tmux-web\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    npm: () => ({ stdout: "", stderr: "" }),
    systemctl: (args) => (args.includes("is-active") ? { stdout: "inactive", stderr: "" } : { stdout: "", stderr: "" }),
  });
  let refreshServiceCalled = false;
  const refreshService = async (): Promise<void> => {
    refreshServiceCalled = true;
  };

  await runUpgrade(["--tag", "v1.0.0"], { exec, appDir, refreshService });

  assert.equal(refreshServiceCalled, false);
});

test("runUpgrade still restarts the service when refreshing the systemd unit fails", async () => {
  const appDir = "/existing/app/dir";
  const { exec, calls } = recordingExec({
    git: (args) => {
      if (args.includes("rev-parse")) return { stdout: "true", stderr: "" };
      if (args.includes("get-url")) return { stdout: "git@github.com:tanyudii/tmux-web\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    npm: () => ({ stdout: "", stderr: "" }),
    systemctl: (args) => (args.includes("is-active") ? { stdout: "active", stderr: "" } : { stdout: "", stderr: "" }),
  });
  const refreshService = async (): Promise<void> => {
    throw new Error("could not write unit file");
  };

  await runUpgrade(["--tag", "v1.0.0"], { exec, appDir, refreshService });

  assert.ok(calls.includes("systemctl --user restart tmux-web"), "must still attempt a restart");
});

test("runUpgrade throws UpgradeError when --tag is passed without a value", async () => {
  const { exec } = recordingExec({});
  await assert.rejects(() => runUpgrade(["--tag"], { exec }), UpgradeError);
});

test("runUpgrade throws UpgradeError when --app-dir is passed without a value", async () => {
  const { exec } = recordingExec({});
  await assert.rejects(() => runUpgrade(["--tag", "v1.0.0", "--app-dir"], { exec }), UpgradeError);
});

test("runUpgrade honors an explicit --app-dir over the default", async () => {
  const customAppDir = "/custom/path";
  const { exec, calls } = recordingExec({
    git: (args) => {
      if (args.includes("rev-parse")) throw new Error("fatal: not a git repository");
      return { stdout: "", stderr: "" };
    },
    npm: () => ({ stdout: "", stderr: "" }),
    systemctl: (args) => (args.includes("is-active") ? { stdout: "inactive", stderr: "" } : { stdout: "", stderr: "" }),
  });

  await runUpgrade(["--tag", "v1.0.0", "--app-dir", customAppDir], { exec, mkdirRecursive: noopMkdir });

  assert.deepEqual(calls, [
    `git -C ${customAppDir} rev-parse --is-inside-work-tree`,
    `git clone --branch v1.0.0 --depth 1 git@github.com:tanyudii/tmux-web ${customAppDir}`,
    `npm ci --omit=dev (cwd=${customAppDir})`,
    `npm link (cwd=${customAppDir})`,
    "systemctl --user is-active tmux-web",
  ]);
});

function isGitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test(
  "real git integration: cloneOrUpdateAppDir clones fresh, then fetches+checks out a new tag in place (no re-clone)",
  { skip: !isGitAvailable() },
  async () => {
    const originPath = await mkdtemp(join(tmpdir(), "upgrade-test-origin-"));
    const parentPath = await mkdtemp(join(tmpdir(), "upgrade-test-parent-"));
    const appDir = join(parentPath, "app");
    try {
      await execFileAsync("git", ["init", "--quiet", "--initial-branch=main", originPath]);
      await execFileAsync("git", ["-C", originPath, "config", "user.email", "test@example.com"]);
      await execFileAsync("git", ["-C", originPath, "config", "user.name", "Test"]);

      await writeFile(join(originPath, "VERSION"), "v1\n");
      await execFileAsync("git", ["-C", originPath, "add", "VERSION"]);
      await execFileAsync("git", ["-C", originPath, "commit", "--quiet", "-m", "v1"]);
      await execFileAsync("git", ["-C", originPath, "tag", "v1.0.0"]);

      await writeFile(join(originPath, "VERSION"), "v2\n");
      await execFileAsync("git", ["-C", originPath, "add", "VERSION"]);
      await execFileAsync("git", ["-C", originPath, "commit", "--quiet", "-m", "v2"]);
      await execFileAsync("git", ["-C", originPath, "tag", "v2.0.0"]);

      await cloneOrUpdateAppDir(defaultExec, appDir, originPath, "v1.0.0");
      assert.equal(await readFile(join(appDir, "VERSION"), "utf-8"), "v1\n");

      await cloneOrUpdateAppDir(defaultExec, appDir, originPath, "v2.0.0");
      assert.equal(await readFile(join(appDir, "VERSION"), "utf-8"), "v2\n");
    } finally {
      await rm(originPath, { recursive: true, force: true });
      await rm(parentPath, { recursive: true, force: true });
    }
  },
);

test(
  "real npm integration: npmInstallAndLink installs deps and links a global bin outside node_modules",
  async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "upgrade-test-fixture-"));
    const npmPrefixDir = await mkdtemp(join(tmpdir(), "upgrade-test-prefix-"));
    const previousPrefix = process.env.npm_config_prefix;
    try {
      await writeFile(
        join(fixtureDir, "package.json"),
        JSON.stringify({
          name: "upgrade-test-fixture",
          version: "1.0.0",
          bin: { "upgrade-test-fixture": "./bin/fake-cli.mjs" },
        }),
      );
      await writeFile(
        join(fixtureDir, "package-lock.json"),
        JSON.stringify({
          name: "upgrade-test-fixture",
          version: "1.0.0",
          lockfileVersion: 3,
          requires: true,
          packages: { "": { name: "upgrade-test-fixture", version: "1.0.0" } },
        }),
      );
      await mkdir(join(fixtureDir, "bin"), { recursive: true });
      await writeFile(join(fixtureDir, "bin", "fake-cli.mjs"), '#!/usr/bin/env node\nconsole.log("ok");\n');

      process.env.npm_config_prefix = npmPrefixDir;
      await npmInstallAndLink(defaultExec, fixtureDir);

      const linkPath = join(npmPrefixDir, "bin", "upgrade-test-fixture");
      const linkStat = await lstat(linkPath);
      assert.ok(linkStat.isSymbolicLink());

      const resolvedLink = await realpath(linkPath);
      const resolvedFixtureBin = await realpath(join(fixtureDir, "bin", "fake-cli.mjs"));
      assert.equal(resolvedLink, resolvedFixtureBin);
    } finally {
      if (previousPrefix === undefined) delete process.env.npm_config_prefix;
      else process.env.npm_config_prefix = previousPrefix;
      await rm(fixtureDir, { recursive: true, force: true });
      await rm(npmPrefixDir, { recursive: true, force: true });
    }
  },
);
