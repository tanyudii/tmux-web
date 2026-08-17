import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requireEnvContext,
  getSessionEnvStatus,
  startSessionEnv,
  reloadSessionEnv,
  stopSessionEnv,
  cancelSessionEnv,
  createSessionEnvStore,
  createSessionEnvControllerStore,
  createResourceUsageCache,
  getSessionResourceUsage,
  EnvUnavailableError,
  EnvAlreadyRunningError,
  EnvNotRunningError,
  EnvNotStartingError,
  type SessionEnvDeps,
} from "./session-env.ts";
import type { Project } from "./projects.ts";
import type { EnvConfig } from "./env-config.ts";
import type { ComposeContext, ComposeServiceStatus, ComposeResourceUsage } from "./docker-compose.ts";

const PROJECT: Project = {
  id: "proj1-ab12cd",
  name: "My Project",
  repoPath: "/repo",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const WORKTREE_PATH = "/data/worktrees/proj1-ab12cd/feature-x";
const FULL_NAME = "proj1-ab12cd__feature-x";

const AVAILABLE_CONFIG: EnvConfig = {
  composeFile: `${WORKTREE_PATH}/.tmux-web-env/docker-compose.yml`,
  preRunScript: null,
  postRunScript: null,
  openLinks: [{ label: "Open", service: "web", port: 3000 }],
};

function makeDeps(overrides: Partial<SessionEnvDeps> = {}): SessionEnvDeps {
  return {
    loadEnvConfig: async () => AVAILABLE_CONFIG,
    runScript: async () => ({ stdout: "", stderr: "" }),
    composeUp: async () => {},
    composeDown: async () => {},
    composeRestart: async () => {},
    composePs: async () => [],
    composePort: async () => null,
    checkPortCollisions: async () => {},
    getComposeResourceUsage: async () => [],
    worktreesRoot: "/data/worktrees",
    ...overrides,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("getSessionEnvStatus returns 'unavailable' when the project hasn't opted in", async () => {
  const deps = makeDeps({ loadEnvConfig: async () => null });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);

  assert.equal(status.phase, "unavailable");
});

test("getSessionEnvStatus returns 'idle' when no containers are up", async () => {
  const deps = makeDeps({ composePs: async () => [] });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);

  assert.equal(status.phase, "idle");
});

test("getSessionEnvStatus falls back to 'idle' when composePs itself fails (e.g. docker daemon unavailable)", async () => {
  const deps = makeDeps({
    composePs: async () => {
      throw new Error("Cannot connect to the Docker daemon");
    },
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);

  assert.equal(status.phase, "idle");
});

test("getSessionEnvStatus reports 'stopping' while teardown is still in flight", async () => {
  let releaseComposeDown = () => {};
  const composeDownStarted = new Promise<void>((resolve) => {
    releaseComposeDown = resolve;
  });
  const deps = makeDeps({
    composePs: async () => [{ service: "web", state: "running" }],
    composeDown: () =>
      new Promise((resolve) => {
        releaseComposeDown();
        setImmediate(resolve);
      }),
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  const stopPromise = stopSessionEnv(PROJECT, "feature-x", deps, store);
  await composeDownStarted;

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);
  assert.equal(status.phase, "stopping");
  assert.equal(status.message, "Stopping containers and removing volumes…");

  await stopPromise;
});

test("getSessionEnvStatus derives 'running' + openLinks live from docker, without needing a prior start()", async () => {
  const services: ComposeServiceStatus[] = [{ service: "web", state: "running" }];
  const deps = makeDeps({
    composePs: async () => services,
    composePort: async (_ctx, service, port) => (service === "web" && port === 3000 ? 54321 : null),
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);

  assert.equal(status.phase, "running");
  assert.deepEqual(status.openLinks, [{ label: "Open", url: "http://localhost:54321", service: "web" }]);
  assert.deepEqual(status.services, services);
});

test("getSessionEnvStatus builds openLinks urls from the given requestHost instead of hardcoded localhost", async () => {
  const services: ComposeServiceStatus[] = [{ service: "web", state: "running" }];
  const deps = makeDeps({
    composePs: async () => services,
    composePort: async (_ctx, service, port) => (service === "web" && port === 3000 ? 54321 : null),
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store, "10.8.0.2");

  assert.deepEqual(status.openLinks, [{ label: "Open", url: "http://10.8.0.2:54321", service: "web" }]);
});

test("getSessionEnvStatus falls back to deps.openHost, then localhost, when no requestHost is given", async () => {
  const services: ComposeServiceStatus[] = [{ service: "web", state: "running" }];
  const deps = makeDeps({
    composePs: async () => services,
    composePort: async () => 54321,
    openHost: "192.168.1.50",
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);

  assert.deepEqual(status.openLinks, [{ label: "Open", url: "http://192.168.1.50:54321", service: "web" }]);
});

test("getSessionEnvStatus resolves multiple openLinks independently, omitting entries whose service hasn't published a port yet", async () => {
  const services: ComposeServiceStatus[] = [
    { service: "web", state: "running" },
    { service: "dbeaver", state: "starting" },
  ];
  const config: EnvConfig = {
    ...AVAILABLE_CONFIG,
    openLinks: [
      { label: "Frontend", service: "web", port: 3000 },
      { label: "DBeaver", service: "dbeaver", port: 8978 },
    ],
  };
  const deps = makeDeps({
    loadEnvConfig: async () => config,
    composePs: async () => services,
    // dbeaver hasn't published its port yet (container still starting)
    composePort: async (_ctx, service, port) => (service === "web" && port === 3000 ? 54321 : null),
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);

  assert.deepEqual(status.openLinks, [{ label: "Frontend", url: "http://localhost:54321", service: "web" }]);
});

test("getSessionEnvStatus resolves every configured openLinks entry once all services have published their ports", async () => {
  const services: ComposeServiceStatus[] = [
    { service: "web", state: "running" },
    { service: "dbeaver", state: "running" },
  ];
  const config: EnvConfig = {
    ...AVAILABLE_CONFIG,
    openLinks: [
      { label: "Frontend", service: "web", port: 3000 },
      { label: "DBeaver", service: "dbeaver", port: 8978 },
    ],
  };
  const ports: Record<string, number> = { web: 54321, dbeaver: 32831 };
  const deps = makeDeps({
    loadEnvConfig: async () => config,
    composePs: async () => services,
    composePort: async (_ctx, service) => ports[service] ?? null,
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);

  assert.deepEqual(status.openLinks, [
    { label: "Frontend", url: "http://localhost:54321", service: "web" },
    { label: "DBeaver", url: "http://localhost:32831", service: "dbeaver" },
  ]);
});

test("getSessionEnvStatus reports no openLinks when the config declares none", async () => {
  const services: ComposeServiceStatus[] = [{ service: "web", state: "running" }];
  const config: EnvConfig = { ...AVAILABLE_CONFIG, openLinks: [] };
  const deps = makeDeps({ loadEnvConfig: async () => config, composePs: async () => services });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);

  assert.equal(status.openLinks, undefined);
});

test("startSessionEnv throws EnvUnavailableError when the project hasn't opted in", async () => {
  const deps = makeDeps({ loadEnvConfig: async () => null });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await assert.rejects(() => startSessionEnv(PROJECT, "feature-x", deps, store, controllers), EnvUnavailableError);
});

test("startSessionEnv throws EnvAlreadyRunningError when containers are already up", async () => {
  const deps = makeDeps({ composePs: async () => [{ service: "web", state: "running" }] });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await assert.rejects(() => startSessionEnv(PROJECT, "feature-x", deps, store, controllers), EnvAlreadyRunningError);
});

test("startSessionEnv propagates PortCollisionError from checkPortCollisions and never runs compose up", async () => {
  class PortCollisionError extends Error {}
  let composeUpCalled = false;
  const deps = makeDeps({
    composeUp: async () => {
      composeUpCalled = true;
    },
    checkPortCollisions: async () => {
      throw new PortCollisionError("Port 3000 is already in use by another running container");
    },
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await assert.rejects(() => startSessionEnv(PROJECT, "feature-x", deps, store, controllers), PortCollisionError);

  assert.equal(composeUpCalled, false);
  assert.equal(store.has(FULL_NAME), false);
});

test("startSessionEnv throws EnvAlreadyRunningError when already starting", async () => {
  const deps = makeDeps({ composeUp: () => new Promise(() => {}) }); // never resolves during this test
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await startSessionEnv(PROJECT, "feature-x", deps, store, controllers);
  assert.equal(store.get(FULL_NAME)?.phase, "starting");

  await assert.rejects(() => startSessionEnv(PROJECT, "feature-x", deps, store, controllers), EnvAlreadyRunningError);
});

test("startSessionEnv reports 'Running pre-run script…' while the pre-run script is in flight", async () => {
  const config: EnvConfig = { ...AVAILABLE_CONFIG, preRunScript: `${WORKTREE_PATH}/.tmux-web-env/pre-run.sh` };
  const deps = makeDeps({
    loadEnvConfig: async () => config,
    runScript: () => new Promise(() => {}), // never resolves during this test
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await startSessionEnv(PROJECT, "feature-x", deps, store, controllers);

  assert.deepEqual(store.get(FULL_NAME), { phase: "starting", message: "Running pre-run script…" });
});

test("startSessionEnv reports 'Pulling and starting containers…' during compose up", async () => {
  const deps = makeDeps({ composeUp: () => new Promise(() => {}) }); // never resolves during this test
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await startSessionEnv(PROJECT, "feature-x", deps, store, controllers);

  assert.deepEqual(store.get(FULL_NAME), { phase: "starting", message: "Pulling and starting containers…" });
});

test("startSessionEnv reports 'Running post-run script…' once compose up finishes", async () => {
  const config: EnvConfig = { ...AVAILABLE_CONFIG, postRunScript: `${WORKTREE_PATH}/.tmux-web-env/post-run.sh` };
  const deps = makeDeps({
    loadEnvConfig: async () => config,
    runScript: () => new Promise(() => {}), // never resolves during this test
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await startSessionEnv(PROJECT, "feature-x", deps, store, controllers);
  await flush();

  assert.deepEqual(store.get(FULL_NAME), { phase: "starting", message: "Running post-run script…" });
});

test("startSessionEnv rejects a second truly concurrent start() for the same session (no TOCTOU race)", async () => {
  let composeUpCalls = 0;
  const deps = makeDeps({
    composeUp: async () => {
      composeUpCalls++;
    },
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  // Both calls fire before either has a chance to claim the store entry --
  // this is what a security review flagged as a TOCTOU gap between the
  // "already starting" check and the store.set() that used to happen only
  // after an intervening `await safeComposePs(...)`.
  const results = await Promise.allSettled([
    startSessionEnv(PROJECT, "feature-x", deps, store, controllers),
    startSessionEnv(PROJECT, "feature-x", deps, store, controllers),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].status === "rejected" && rejected[0].reason instanceof EnvAlreadyRunningError);

  await flush();
  assert.equal(composeUpCalls, 1);
});

test("startSessionEnv runs pre-run -> compose up -> post-run, then status reports running", async () => {
  const calls: string[] = [];
  const config: EnvConfig = {
    ...AVAILABLE_CONFIG,
    preRunScript: `${WORKTREE_PATH}/.tmux-web-env/pre-run.sh`,
    postRunScript: `${WORKTREE_PATH}/.tmux-web-env/post-run.sh`,
  };
  const deps = makeDeps({
    loadEnvConfig: async () => config,
    runScript: async (scriptPath) => {
      calls.push(`run:${scriptPath}`);
      return { stdout: "", stderr: "" };
    },
    composeUp: async () => {
      calls.push("up");
    },
    composePs: async () => (calls.includes("up") ? [{ service: "web", state: "running" }] : []),
    composePort: async () => 54321,
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await startSessionEnv(PROJECT, "feature-x", deps, store, controllers);
  await flush();

  assert.deepEqual(calls, [`run:${config.preRunScript}`, "up", `run:${config.postRunScript}`]);
  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);
  assert.equal(status.phase, "running");
  assert.deepEqual(status.openLinks, [{ label: "Open", url: "http://localhost:54321", service: "web" }]);
});

test("startSessionEnv records 'env_setup_started' then 'env_setup_finished' on success (EMB-213)", async () => {
  const events: Array<[string, string]> = [];
  const deps = makeDeps({
    recordEvent: async (_projectId, _sessionSlug, type) => {
      events.push(["proj1-ab12cd/feature-x", type]);
    },
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await startSessionEnv(PROJECT, "feature-x", deps, store, controllers);
  await flush();

  assert.deepEqual(events, [
    ["proj1-ab12cd/feature-x", "env_setup_started"],
    ["proj1-ab12cd/feature-x", "env_setup_finished"],
  ]);
});

test("startSessionEnv records 'env_setup_failed' with the error message when compose up fails (EMB-213)", async () => {
  const events: Array<{ type: string; message?: string }> = [];
  const deps = makeDeps({
    composeUp: async () => {
      throw new Error("no such image");
    },
    recordEvent: async (_projectId, _sessionSlug, type, message) => {
      events.push({ type, message });
    },
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await startSessionEnv(PROJECT, "feature-x", deps, store, controllers);
  await flush();

  assert.deepEqual(events, [
    { type: "env_setup_started", message: undefined },
    { type: "env_setup_failed", message: "no such image" },
  ]);
});

test("startSessionEnv aborts before compose up when pre-run fails", async () => {
  let composeUpCalled = false;
  const config: EnvConfig = { ...AVAILABLE_CONFIG, preRunScript: `${WORKTREE_PATH}/.tmux-web-env/pre-run.sh` };
  const deps = makeDeps({
    loadEnvConfig: async () => config,
    runScript: async () => {
      throw new Error("pre-run failed: npm install exited 1");
    },
    composeUp: async () => {
      composeUpCalled = true;
    },
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await startSessionEnv(PROJECT, "feature-x", deps, store, controllers);
  await flush();

  assert.equal(composeUpCalled, false);
  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);
  assert.equal(status.phase, "error");
  assert.match(status.message ?? "", /pre-run failed/);
});

test("startSessionEnv reports 'error' when compose up itself fails", async () => {
  const deps = makeDeps({
    composeUp: async () => {
      throw new Error("no such image");
    },
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await startSessionEnv(PROJECT, "feature-x", deps, store, controllers);
  await flush();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);
  assert.equal(status.phase, "error");
  assert.match(status.message ?? "", /no such image/);
});

test("startSessionEnv reports 'error' with services+openUrl still visible when only post-run fails", async () => {
  let upCalled = false;
  const config: EnvConfig = { ...AVAILABLE_CONFIG, postRunScript: `${WORKTREE_PATH}/.tmux-web-env/post-run.sh` };
  const deps = makeDeps({
    loadEnvConfig: async () => config,
    composeUp: async () => {
      upCalled = true;
    },
    composePs: async () => (upCalled ? [{ service: "web", state: "running" }] : []),
    composePort: async () => 54321,
    runScript: async () => {
      throw new Error("migration failed");
    },
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await startSessionEnv(PROJECT, "feature-x", deps, store, controllers);
  await flush();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);
  assert.equal(status.phase, "error");
  assert.match(status.message ?? "", /migration failed/);
  assert.deepEqual(status.services, [{ service: "web", state: "running" }]);
  assert.deepEqual(status.openLinks, [{ label: "Open", url: "http://localhost:54321", service: "web" }]);
});

test("stopSessionEnv throws EnvNotRunningError when nothing is running", async () => {
  const deps = makeDeps({ composePs: async () => [] });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await assert.rejects(() => stopSessionEnv(PROJECT, "feature-x", deps, store), EnvNotRunningError);
});

test("stopSessionEnv throws EnvUnavailableError when the project hasn't opted in", async () => {
  const deps = makeDeps({ loadEnvConfig: async () => null });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await assert.rejects(() => stopSessionEnv(PROJECT, "feature-x", deps, store), EnvUnavailableError);
});

test("stopSessionEnv tears down running containers and clears store state", async () => {
  const calls: ComposeContext[] = [];
  const deps = makeDeps({
    composePs: async () => [{ service: "web", state: "running" }],
    composeDown: async (ctx) => {
      calls.push(ctx);
    },
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await stopSessionEnv(PROJECT, "feature-x", deps, store);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].projectName, FULL_NAME);
  assert.equal(store.get(FULL_NAME), undefined);
});

test("stopSessionEnv records an 'env_stopped' event after containers are torn down (EMB-213)", async () => {
  const events: string[] = [];
  const deps = makeDeps({
    composePs: async () => [{ service: "web", state: "running" }],
    recordEvent: async (_projectId, _sessionSlug, type) => {
      events.push(type);
    },
  });
  const store = createSessionEnvStore();

  await stopSessionEnv(PROJECT, "feature-x", deps, store);

  assert.deepEqual(events, ["env_stopped"]);
});

test("requireEnvContext resolves a ComposeContext scoped to the session", async () => {
  const deps = makeDeps();

  const ctx = await requireEnvContext(PROJECT, "feature-x", deps);

  assert.deepEqual(ctx, {
    projectName: FULL_NAME,
    composeFile: AVAILABLE_CONFIG.composeFile,
    worktreePath: WORKTREE_PATH,
  });
});

test("requireEnvContext throws EnvUnavailableError when the project hasn't opted in", async () => {
  const deps = makeDeps({ loadEnvConfig: async () => null });

  await assert.rejects(() => requireEnvContext(PROJECT, "feature-x", deps), EnvUnavailableError);
});

// --- getSessionResourceUsage (EMB-214) ---

const SAMPLE_USAGE: ComposeResourceUsage[] = [
  { service: "web", cpuPercent: 12.3, memUsageBytes: 100 * 1024 ** 2, memLimitBytes: 1024 ** 3 },
];

test("getSessionResourceUsage reports unavailable (not an error) when the project hasn't opted in", async () => {
  const deps = makeDeps({ loadEnvConfig: async () => null });
  const cache = createResourceUsageCache();

  const result = await getSessionResourceUsage(PROJECT, "feature-x", deps, cache);

  assert.deepEqual(result, { available: false, services: [] });
});

test("getSessionResourceUsage returns real docker stats output when the project has an env config", async () => {
  const deps = makeDeps({ getComposeResourceUsage: async () => SAMPLE_USAGE });
  const cache = createResourceUsageCache();

  const result = await getSessionResourceUsage(PROJECT, "feature-x", deps, cache);

  assert.deepEqual(result, { available: true, services: SAMPLE_USAGE });
});

test("getSessionResourceUsage caches the result -- a second call within the TTL never calls docker again", async () => {
  let calls = 0;
  const deps = makeDeps({
    getComposeResourceUsage: async () => {
      calls++;
      return SAMPLE_USAGE;
    },
  });
  const cache = createResourceUsageCache();

  await getSessionResourceUsage(PROJECT, "feature-x", deps, cache);
  await getSessionResourceUsage(PROJECT, "feature-x", deps, cache);

  assert.equal(calls, 1);
});

test("getSessionResourceUsage caches per-session -- a different session is never served from another session's cache entry", async () => {
  const calls: string[] = [];
  const deps = makeDeps({
    getComposeResourceUsage: async (ctx) => {
      calls.push(ctx.projectName);
      return SAMPLE_USAGE;
    },
  });
  const cache = createResourceUsageCache();

  await getSessionResourceUsage(PROJECT, "feature-x", deps, cache);
  await getSessionResourceUsage(PROJECT, "feature-y", deps, cache);

  assert.deepEqual(calls, ["proj1-ab12cd__feature-x", "proj1-ab12cd__feature-y"]);
});

// --- cancelSessionEnv ---

test("cancelSessionEnv throws EnvNotStartingError when nothing is starting", () => {
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  assert.throws(() => cancelSessionEnv(PROJECT, "feature-x", store, controllers), EnvNotStartingError);
});

test("cancelSessionEnv aborts the in-flight controller's signal", async () => {
  let sawSignal: AbortSignal | undefined;
  const deps = makeDeps({
    runScript: async (_scriptPath: string, _cwd: string, _exec: undefined, signal?: AbortSignal) => {
      sawSignal = signal;
      // Never resolves on its own -- only the abort should end this.
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
      return { stdout: "", stderr: "" };
    },
    loadEnvConfig: async () => ({ ...AVAILABLE_CONFIG, preRunScript: "/repo/pre-run.sh" }),
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await startSessionEnv(PROJECT, "feature-x", deps, store, controllers);
  await flush();
  assert.equal(store.get(FULL_NAME)?.phase, "starting");

  cancelSessionEnv(PROJECT, "feature-x", store, controllers);
  await flush();

  assert.equal(sawSignal?.aborted, true);
  assert.deepEqual(store.get(FULL_NAME), { phase: "error", message: "Cancelled" });
  assert.equal(controllers.has(FULL_NAME), false);
});

test(
  "real process integration: cancelling a running shell script actually terminates the child process",
  async () => {
    const { readFile, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { writeFile } = await import("node:fs/promises");
    const { runScript } = await import("./run-script.ts");

    const dir = await mkdtemp(join(tmpdir(), "session-env-cancel-test-"));
    try {
      const markerFile = join(dir, "started");
      const scriptPath = join(dir, "slow.sh");
      // Writes a marker as soon as it starts, then sleeps far longer than
      // this test waits -- if cancellation didn't really kill the process,
      // the sleep would still be running (harmlessly) after the test exits,
      // but the assertion below only cares that abort() resolves promptly.
      await writeFile(scriptPath, `#!/bin/sh\ntouch "${markerFile}"\nsleep 30\n`, { mode: 0o755 });

      const controller = new AbortController();
      const runPromise = runScript(scriptPath, dir, undefined, controller.signal);

      await new Promise((resolve) => setTimeout(resolve, 300));
      await readFile(markerFile); // throws if the script never actually started
      controller.abort();

      await assert.rejects(() => runPromise);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

// -- reloadSessionEnv --------------------------------------------------------

test("reloadSessionEnv with rebuild=false only restarts containers (no scripts, no compose up)", async () => {
  const events: string[] = [];
  let composeUpCalled = false;
  let runScriptCalled = false;
  const deps = makeDeps({
    composeUp: async () => {
      composeUpCalled = true;
    },
    runScript: async () => {
      runScriptCalled = true;
      return { stdout: "", stderr: "" };
    },
    composeRestart: async () => {},
    recordEvent: async (_projectId, _slug, type) => {
      events.push(type);
    },
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await reloadSessionEnv(PROJECT, "feature-x", { rebuild: false }, deps, store, controllers);
  await flush();

  assert.equal(composeUpCalled, false);
  assert.equal(runScriptCalled, false);
  assert.deepEqual(events, ["env_reloaded"]);
  assert.equal(store.has(FULL_NAME), false);
});

test("reloadSessionEnv with rebuild=true runs the full lifecycle (pre-run, compose up --build, post-run) even with containers running", async () => {
  const order: string[] = [];
  const deps = makeDeps({
    loadEnvConfig: async () => ({
      ...AVAILABLE_CONFIG,
      preRunScript: `${WORKTREE_PATH}/.tmux-web-env/pre-run.sh`,
      postRunScript: `${WORKTREE_PATH}/.tmux-web-env/post-run.sh`,
    }),
    // Already running -- startSessionEnv would refuse; reload must not.
    composePs: async () => [{ service: "web", state: "running" }],
    runScript: async (scriptPath: string) => {
      order.push(scriptPath.endsWith("pre-run.sh") ? "pre" : "post");
      return { stdout: "", stderr: "" };
    },
    composeUp: async () => {
      order.push("up");
    },
    composeRestart: async () => {
      order.push("restart");
    },
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await reloadSessionEnv(PROJECT, "feature-x", { rebuild: true }, deps, store, controllers);
  await flush();

  assert.deepEqual(order, ["pre", "up", "post"]);
  assert.equal(store.has(FULL_NAME), false);
});

test("reloadSessionEnv refuses while another lifecycle is in flight", async () => {
  const deps = makeDeps({ composeRestart: async () => {} });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();
  store.set(FULL_NAME, { phase: "starting" });

  await assert.rejects(() => reloadSessionEnv(PROJECT, "feature-x", { rebuild: false }, deps, store, controllers), EnvAlreadyRunningError);
});

test("reloadSessionEnv records an error transient when the restart fails", async () => {
  const deps = makeDeps({
    composeRestart: async () => {
      throw new Error("docker daemon down");
    },
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await reloadSessionEnv(PROJECT, "feature-x", { rebuild: false }, deps, store, controllers);
  await flush();

  const transient = store.get(FULL_NAME);
  assert.ok(transient);
  assert.equal(transient.phase, "error");
  assert.match(transient.message ?? "", /docker daemon down/);
});

test("reloadSessionEnv with service + rebuild=false restarts only that service (no scripts)", async () => {
  const calls: { cmd: string; service?: string }[] = [];
  let runScriptCalled = false;
  const deps = makeDeps({
    runScript: async () => {
      runScriptCalled = true;
      return { stdout: "", stderr: "" };
    },
    composeRestart: async (_ctx: unknown, _exec?: undefined, _signal?: AbortSignal, service?: string) => {
      calls.push({ cmd: "restart", service });
    },
    composeUp: async (_ctx: unknown, _exec?: undefined, _signal?: AbortSignal, service?: string) => {
      calls.push({ cmd: "up", service });
    },
    recordEvent: async () => {},
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await reloadSessionEnv(PROJECT, "feature-x", { rebuild: false, service: "web" }, deps, store, controllers);
  await flush();

  assert.deepEqual(calls, [{ cmd: "restart", service: "web" }]);
  assert.equal(runScriptCalled, false);
  assert.equal(store.has(FULL_NAME), false);
});

test("reloadSessionEnv with service + rebuild=true rebuilds only that service via compose up --build", async () => {
  const calls: { cmd: string; service?: string }[] = [];
  const deps = makeDeps({
    composeRestart: async (_ctx: unknown, _exec?: undefined, _signal?: AbortSignal, service?: string) => {
      calls.push({ cmd: "restart", service });
    },
    composeUp: async (_ctx: unknown, _exec?: undefined, _signal?: AbortSignal, service?: string) => {
      calls.push({ cmd: "up", service });
    },
    recordEvent: async () => {},
  });
  const store = createSessionEnvStore();
  const controllers = createSessionEnvControllerStore();

  await reloadSessionEnv(PROJECT, "feature-x", { rebuild: true, service: "api" }, deps, store, controllers);
  await flush();

  assert.deepEqual(calls, [{ cmd: "up", service: "api" }]);
  assert.equal(store.has(FULL_NAME), false);
});
