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
    runConfigCommand: async (args) => {
      calls.push(`runConfigCommand ${args.join(" ")}`);
    },
    runUserCommand: async (args) => {
      calls.push(`runUserCommand ${args.join(" ")}`);
    },
    runServiceCommand: async (args) => {
      calls.push(`runServiceCommand ${args.join(" ")}`);
    },
    runUpgrade: async (args) => {
      calls.push(`runUpgrade ${args.join(" ")}`);
    },
    runMcpCommand: async (args) => {
      calls.push(`runMcpCommand ${args.join(" ")}`);
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

test("routes init/config/user/service/upgrade with the remaining args", async () => {
  const { deps, calls } = recordingDeps();
  await runCli(["init", "--force"], deps);
  await runCli(["config", "port", "1234"], deps);
  await runCli(["user", "add", "alice", "password123"], deps);
  await runCli(["service", "status"], deps);
  await runCli(["upgrade", "--tag", "v1.2.3"], deps);
  assert.deepEqual(calls, [
    "runInit --force",
    "runConfigCommand port 1234",
    "runUserCommand add alice password123",
    "runServiceCommand status",
    "runUpgrade --tag v1.2.3",
  ]);
});

test("`mcp` starts the MCP server, forwarding remaining args", async () => {
  const { deps, calls } = recordingDeps();
  await runCli(["mcp"], deps);
  assert.deepEqual(calls, ["runMcpCommand "]);

  const { deps: deps2, calls: calls2 } = recordingDeps();
  await runCli(["mcp", "--http", "--port", "5311"], deps2);
  assert.deepEqual(calls2, ["runMcpCommand --http --port 5311"]);
});

test("unknown command prints an error, shows help, and exits 1", async () => {
  const { deps, calls } = recordingDeps();
  await runCli(["bogus"], deps);
  assert.deepEqual(calls, ["printHelp", "exit 1"]);
});
