import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeUp,
  composeDown,
  composePs,
  composePort,
  composeLogsArgs,
  DockerComposeError,
  type ComposeContext,
} from "./docker-compose.ts";

const ctx: ComposeContext = {
  projectName: "proj1__feature-x",
  composeFile: "/repo/worktree/.tmux-web-env/docker-compose.yml",
  worktreePath: "/repo/worktree",
};

function baseArgs(): string[] {
  return [
    "compose",
    "-p", "proj1__feature-x",
    "-f", "/repo/worktree/.tmux-web-env/docker-compose.yml",
    "--project-directory", "/repo/worktree",
  ];
}

test("composeUp runs docker compose up -d --build with the right project scoping", async () => {
  const calls: { file: string; args: string[] }[] = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "", stderr: "" };
  };

  await composeUp(ctx, fakeExec);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "docker");
  assert.deepEqual(calls[0].args, [...baseArgs(), "up", "-d", "--build"]);
});

test("composeUp wraps exec failures in DockerComposeError", async () => {
  const fakeExec = async () => {
    throw Object.assign(new Error("boom"), { stderr: "no such image" });
  };

  await assert.rejects(() => composeUp(ctx, fakeExec), (error: unknown) => {
    assert.ok(error instanceof DockerComposeError);
    assert.match((error as Error).message, /no such image/);
    return true;
  });
});

test("composeDown runs docker compose down -v", async () => {
  const calls: string[][] = [];
  const fakeExec = async (_file: string, args: string[]) => {
    calls.push(args);
    return { stdout: "", stderr: "" };
  };

  await composeDown(ctx, fakeExec);

  assert.deepEqual(calls[0], [...baseArgs(), "down", "-v"]);
});

test("composeDown wraps exec failures in DockerComposeError", async () => {
  const fakeExec = async () => {
    throw new Error("daemon not running");
  };

  await assert.rejects(() => composeDown(ctx, fakeExec), DockerComposeError);
});

test("composePs parses one-JSON-object-per-line output", async () => {
  const fakeExec = async () => ({
    stdout:
      '{"Service":"web","State":"running","Health":"healthy"}\n' +
      '{"Service":"db","State":"running"}\n',
    stderr: "",
  });

  const result = await composePs(ctx, fakeExec);

  assert.deepEqual(result, [
    { service: "web", state: "running", health: "healthy" },
    { service: "db", state: "running", health: undefined },
  ]);
});

test("composePs wraps exec failures in DockerComposeError", async () => {
  const fakeExec = async () => {
    throw new Error("no such project");
  };

  await assert.rejects(() => composePs(ctx, fakeExec), DockerComposeError);
});

test("composePort resolves the published host port", async () => {
  const calls: string[][] = [];
  const fakeExec = async (_file: string, args: string[]) => {
    calls.push(args);
    return { stdout: "0.0.0.0:54321\n", stderr: "" };
  };

  const port = await composePort(ctx, "web", 3000, fakeExec);

  assert.equal(port, 54321);
  assert.deepEqual(calls[0], [...baseArgs(), "port", "web", "3000"]);
});

test("composePort returns null when the service publishes no port", async () => {
  const fakeExec = async () => {
    throw Object.assign(new Error("failed"), { stderr: "no port mapping found" });
  };

  const port = await composePort(ctx, "worker", 3000, fakeExec);

  assert.equal(port, null);
});

test("composePort rethrows unexpected failures as DockerComposeError", async () => {
  const fakeExec = async () => {
    throw new Error("daemon not running");
  };

  await assert.rejects(() => composePort(ctx, "web", 3000, fakeExec), DockerComposeError);
});

test("composeLogsArgs builds a follow+tail command scoped to the session, without a service filter", () => {
  assert.deepEqual(composeLogsArgs(ctx), [...baseArgs(), "logs", "--follow", "--tail=200"]);
});

test("composeLogsArgs appends the service name when filtering to a single service", () => {
  assert.deepEqual(composeLogsArgs(ctx, "web"), [...baseArgs(), "logs", "--follow", "--tail=200", "web"]);
});
