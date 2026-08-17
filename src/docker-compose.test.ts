import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeUp,
  composeDown,
  composeRestart,
  composePs,
  composePort,
  composeLogsArgs,
  resolveConfiguredPorts,
  getHostBoundPorts,
  checkPortCollisions,
  getComposeResourceUsage,
  DockerComposeError,
  PortCollisionError,
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

test("getComposeResourceUsage joins docker compose ps with docker stats by container ID, mapping to service names", async () => {
  const calls: string[][] = [];
  const fakeExec = async (_file: string, args: string[]) => {
    calls.push(args);
    if (args.includes("ps")) {
      return {
        stdout:
          '{"ID":"abc123def456789","Service":"web"}\n' +
          '{"ID":"fed654cba987654","Service":"db"}\n',
        stderr: "",
      };
    }
    if (args[0] === "stats") {
      return {
        stdout:
          '{"ID":"abc123def456","CPUPerc":"12.34%","MemUsage":"100MiB / 1GiB"}\n' +
          '{"ID":"fed654cba987","CPUPerc":"0.50%","MemUsage":"50MiB / 2GiB"}\n',
        stderr: "",
      };
    }
    throw new Error(`unexpected exec call: ${args.join(" ")}`);
  };

  const result = await getComposeResourceUsage(ctx, fakeExec);

  assert.deepEqual(result, [
    { service: "web", cpuPercent: 12.34, memUsageBytes: 100 * 1024 ** 2, memLimitBytes: 1024 ** 3 },
    { service: "db", cpuPercent: 0.5, memUsageBytes: 50 * 1024 ** 2, memLimitBytes: 2 * 1024 ** 3 },
  ]);
  assert.deepEqual(calls[0], [...baseArgs(), "ps", "--format", "json"]);
  assert.deepEqual(calls[1], ["stats", "--no-stream", "--format", "json", "abc123def456789", "fed654cba987654"]);
});

test("getComposeResourceUsage returns an empty array when no containers are running", async () => {
  const fakeExec = async (_file: string, args: string[]) => {
    if (args.includes("ps")) return { stdout: "", stderr: "" };
    throw new Error("docker stats should never be called with no containers");
  };

  assert.deepEqual(await getComposeResourceUsage(ctx, fakeExec), []);
});

test("getComposeResourceUsage falls back to the short container ID when no service label matches", async () => {
  const fakeExec = async (_file: string, args: string[]) => {
    if (args.includes("ps")) return { stdout: '{"ID":"abc123def456789"}\n', stderr: "" };
    return { stdout: '{"ID":"abc123def456","CPUPerc":"1%","MemUsage":"1MiB / 1GiB"}\n', stderr: "" };
  };

  const result = await getComposeResourceUsage(ctx, fakeExec);

  assert.equal(result[0].service, "abc123def456");
});

test("getComposeResourceUsage wraps a docker stats failure in DockerComposeError", async () => {
  const fakeExec = async (_file: string, args: string[]) => {
    if (args.includes("ps")) return { stdout: '{"ID":"abc123def456789","Service":"web"}\n', stderr: "" };
    throw new Error("no such container");
  };

  await assert.rejects(() => getComposeResourceUsage(ctx, fakeExec), DockerComposeError);
});

test("getComposeResourceUsage wraps a docker compose ps failure in DockerComposeError", async () => {
  const fakeExec = async () => {
    throw new Error("no such project");
  };

  await assert.rejects(() => getComposeResourceUsage(ctx, fakeExec), DockerComposeError);
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

test("resolveConfiguredPorts extracts published host ports from `docker compose config --format json`, string or number", async () => {
  const calls: string[][] = [];
  const fakeExec = async (_file: string, args: string[]) => {
    calls.push(args);
    return {
      stdout: JSON.stringify({
        services: {
          web: { ports: [{ published: "3000", target: 3000 }] },
          db: { ports: [{ published: 5432, target: 5432 }] },
          worker: { ports: [{ target: 9000 }] },
        },
      }),
      stderr: "",
    };
  };

  const ports = await resolveConfiguredPorts(ctx, fakeExec);

  assert.deepEqual(ports.sort(), [3000, 5432]);
  assert.deepEqual(calls[0], [...baseArgs(), "config", "--format", "json"]);
});

test("resolveConfiguredPorts returns an empty array when no service publishes a fixed port", async () => {
  const fakeExec = async () => ({ stdout: JSON.stringify({ services: {} }), stderr: "" });

  const ports = await resolveConfiguredPorts(ctx, fakeExec);

  assert.deepEqual(ports, []);
});

test("resolveConfiguredPorts wraps exec failures in DockerComposeError", async () => {
  const fakeExec = async () => {
    throw new Error("daemon not running");
  };

  await assert.rejects(() => resolveConfiguredPorts(ctx, fakeExec), DockerComposeError);
});

test("getHostBoundPorts parses host ports from `docker ps --format {{.Ports}}`", async () => {
  const calls: string[][] = [];
  const fakeExec = async (_file: string, args: string[]) => {
    calls.push(args);
    return { stdout: "0.0.0.0:3000->3000/tcp, :::3000->3000/tcp\n0.0.0.0:5432->5432/tcp\n", stderr: "" };
  };

  const ports = await getHostBoundPorts(fakeExec);

  assert.deepEqual([...ports].sort(), [3000, 5432]);
  assert.deepEqual(calls[0], ["ps", "--format", "{{.Ports}}"]);
});

test("getHostBoundPorts wraps exec failures in DockerComposeError", async () => {
  const fakeExec = async () => {
    throw new Error("daemon not running");
  };

  await assert.rejects(() => getHostBoundPorts(fakeExec), DockerComposeError);
});

test("checkPortCollisions throws PortCollisionError when a configured port is already bound", async () => {
  const fakeExec = async (_file: string, args: string[]) => {
    if (args.includes("config")) {
      return { stdout: JSON.stringify({ services: { web: { ports: [{ published: "3000" }] } } }), stderr: "" };
    }
    return { stdout: "0.0.0.0:3000->3000/tcp\n", stderr: "" };
  };

  await assert.rejects(() => checkPortCollisions(ctx, fakeExec), PortCollisionError);
});

test("checkPortCollisions resolves without error when no configured port is already bound", async () => {
  const fakeExec = async (_file: string, args: string[]) => {
    if (args.includes("config")) {
      return { stdout: JSON.stringify({ services: { web: { ports: [{ published: "3000" }] } } }), stderr: "" };
    }
    return { stdout: "0.0.0.0:4000->4000/tcp\n", stderr: "" };
  };

  await checkPortCollisions(ctx, fakeExec);
});

test("checkPortCollisions never calls `docker ps` when the compose file pins no host ports", async () => {
  let psCalled = false;
  const fakeExec = async (_file: string, args: string[]) => {
    if (args.includes("config")) return { stdout: JSON.stringify({ services: {} }), stderr: "" };
    psCalled = true;
    return { stdout: "", stderr: "" };
  };

  await checkPortCollisions(ctx, fakeExec);

  assert.equal(psCalled, false);
});

test("composeRestart runs docker compose restart with the right project scoping", async () => {
  const calls: { file: string; args: string[] }[] = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "", stderr: "" };
  };

  await composeRestart(ctx, fakeExec);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "docker");
  assert.deepEqual(calls[0].args, [...baseArgs(), "restart"]);
});

test("composeRestart wraps exec failures in DockerComposeError", async () => {
  const fakeExec = async () => {
    throw Object.assign(new Error("boom"), { stderr: "cannot restart" });
  };

  await assert.rejects(() => composeRestart(ctx, fakeExec), (error: unknown) => {
    assert.ok(error instanceof DockerComposeError);
    assert.match((error as Error).message, /cannot restart/);
    return true;
  });
});

test("composeRestart targets a single service when given one", async () => {
  const calls: { file: string; args: string[] }[] = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "", stderr: "" };
  };

  await composeRestart(ctx, fakeExec, undefined, "web");

  assert.deepEqual(calls[0].args, [...baseArgs(), "restart", "web"]);
});

test("composeUp builds and recreates only the given service when passed one", async () => {
  const calls: { file: string; args: string[] }[] = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "", stderr: "" };
  };

  await composeUp(ctx, fakeExec, undefined, "api");

  assert.deepEqual(calls[0].args, [...baseArgs(), "up", "-d", "--build", "api"]);
});
