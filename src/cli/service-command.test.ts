import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServiceCommandError, installService, statusService, uninstallService } from "./service-command.ts";
import type { ExecFn } from "./service-command.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-service-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function recordingExec(
  overrides: Record<string, () => { stdout: string; stderr: string }> = {},
): { exec: ExecFn; calls: string[] } {
  const calls: string[] = [];
  const exec: ExecFn = async (file, args) => {
    calls.push(`${file} ${args.join(" ")}`);
    const override = overrides[`${file} ${args[0]}`];
    if (override) return override();
    return { stdout: "", stderr: "" };
  };
  return { exec, calls };
}

test("installService rejects on non-linux platforms", async () => {
  await withTempDir(async (dir) => {
    const { exec } = recordingExec();
    await assert.rejects(
      () =>
        installService({
          platform: "darwin",
          exec,
          homeDir: dir,
          execPathNode: "/usr/bin/node",
          binPath: "/pkg/bin/tmuxweb.ts",
          configDir: "/home/u/.tmux-web",
          username: "u",
        }),
      ServiceCommandError,
    );
  });
});

test("installService writes a systemd unit with resolved paths and no EnvironmentFile", async () => {
  await withTempDir(async (dir) => {
    const { exec, calls } = recordingExec();
    await installService({
      platform: "linux",
      exec,
      homeDir: dir,
      execPathNode: "/usr/bin/node",
      binPath: "/pkg/bin/tmuxweb.ts",
      configDir: "/home/u/.tmux-web",
      username: "u",
    });

    const unitPath = join(dir, ".config", "systemd", "user", "tmux-web.service");
    const unit = await readFile(unitPath, "utf-8");
    assert.match(unit, /ExecStart=\/usr\/bin\/node --experimental-strip-types \/pkg\/bin\/tmuxweb\.ts start/);
    assert.doesNotMatch(unit, /EnvironmentFile/);
    assert.match(unit, /ReadWritePaths=\/home\/u\/\.tmux-web \/tmp/);

    assert.deepEqual(calls, [
      "systemctl --version",
      "systemctl --user daemon-reload",
      "systemctl --user enable --now tmux-web",
      "loginctl enable-linger u",
    ]);
  });
});

test("installService throws when systemctl is unavailable", async () => {
  await withTempDir(async (dir) => {
    const exec: ExecFn = async () => {
      throw new Error("command not found");
    };
    await assert.rejects(
      () =>
        installService({
          platform: "linux",
          exec,
          homeDir: dir,
          execPathNode: "/usr/bin/node",
          binPath: "/pkg/bin/tmuxweb.ts",
          configDir: "/home/u/.tmux-web",
          username: "u",
        }),
      ServiceCommandError,
    );
  });
});

test("uninstallService disables the unit and removes the file", async () => {
  await withTempDir(async (dir) => {
    const { exec: installExec } = recordingExec();
    await installService({
      platform: "linux",
      exec: installExec,
      homeDir: dir,
      execPathNode: "/usr/bin/node",
      binPath: "/pkg/bin/tmuxweb.ts",
      configDir: "/x",
      username: "u",
    });

    const { exec, calls } = recordingExec();
    await uninstallService({ exec, homeDir: dir });

    const unitPath = join(dir, ".config", "systemd", "user", "tmux-web.service");
    await assert.rejects(() => access(unitPath));
    assert.deepEqual(calls, ["systemctl --user disable --now tmux-web", "systemctl --user daemon-reload"]);
  });
});

test("statusService prints stdout on a clean status check", async () => {
  const { exec } = recordingExec({
    "systemctl --user": () => ({ stdout: "active (running)", stderr: "" }),
  });
  await statusService({ exec });
});

test("statusService still succeeds when systemctl exits non-zero but returns status text", async () => {
  const exec: ExecFn = async () => {
    const error = new Error("Command failed") as Error & { stdout?: string };
    error.stdout = "tmux-web.service - inactive (dead)";
    throw error;
  };
  await statusService({ exec });
});

test("statusService throws when systemctl fails with no status text at all", async () => {
  const exec: ExecFn = async () => {
    throw new Error("systemctl: command not found");
  };
  await assert.rejects(() => statusService({ exec }), ServiceCommandError);
});
