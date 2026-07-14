import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "./index.ts";
import type { RunCliDeps } from "./index.ts";

function recordingDeps(): { deps: Required<Omit<RunCliDeps, "exit">> & Pick<RunCliDeps, "exit">; calls: string[] } {
  const calls: string[] = [];
  const deps: Required<Omit<RunCliDeps, "exit">> & Pick<RunCliDeps, "exit"> = {
    startServer: async () => {
      calls.push("startServer");
    },
    printHelp: () => {
      calls.push("printHelp");
    },
    runInit: async (args) => {
      calls.push(`runInit ${args.join(" ")}`);
    },
    runGenerate: async (args) => {
      calls.push(`runGenerate ${args.join(" ")}`);
    },
    runConfigCommand: async (args) => {
      calls.push(`runConfigCommand ${args.join(" ")}`);
    },
    runServiceCommand: async (args) => {
      calls.push(`runServiceCommand ${args.join(" ")}`);
    },
    runUpgrade: async (args) => {
      calls.push(`runUpgrade ${args.join(" ")}`);
    },
    printVersion: () => {
      calls.push("printVersion");
    },
    exit: (code: number) => {
      calls.push(`exit ${code}`);
    },
  };
  return { deps, calls };
}

test("no arguments shows help instead of starting the server", async () => {
  const { deps, calls } = recordingDeps();
  await runCli([], deps);
  assert.deepEqual(calls, ["printHelp"]);
});

test("`start` starts the server", async () => {
  const { deps, calls } = recordingDeps();
  await runCli(["start"], deps);
  assert.deepEqual(calls, ["startServer"]);
});

test("`help`, `-h`, and `--help` show help", async () => {
  for (const arg of ["help", "-h", "--help"]) {
    const { deps, calls } = recordingDeps();
    await runCli([arg], deps);
    assert.deepEqual(calls, ["printHelp"]);
  }
});

test("`--version` and `-v` print the version", async () => {
  for (const arg of ["--version", "-v"]) {
    const { deps, calls } = recordingDeps();
    await runCli([arg], deps);
    assert.deepEqual(calls, ["printVersion"]);
  }
});

test("routes init/generate/config/service/upgrade with the remaining args", async () => {
  const { deps, calls } = recordingDeps();
  await runCli(["init", "--force"], deps);
  await runCli(["generate"], deps);
  await runCli(["config", "port", "1234"], deps);
  await runCli(["service", "status"], deps);
  await runCli(["upgrade", "--tag", "v1.2.3"], deps);
  assert.deepEqual(calls, [
    "runInit --force",
    "runGenerate ",
    "runConfigCommand port 1234",
    "runServiceCommand status",
    "runUpgrade --tag v1.2.3",
  ]);
});

test("unknown command prints an error, shows help, and exits 1", async () => {
  const { deps, calls } = recordingDeps();
  await runCli(["bogus"], deps);
  assert.deepEqual(calls, ["printHelp", "exit 1"]);
});
