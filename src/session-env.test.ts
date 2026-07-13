import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requireEnvContext,
  getSessionEnvStatus,
  startSessionEnv,
  stopSessionEnv,
  createSessionEnvStore,
  EnvUnavailableError,
  EnvAlreadyRunningError,
  EnvNotRunningError,
  type SessionEnvDeps,
} from "./session-env.ts";
import type { Project } from "./projects.ts";
import type { EnvConfig } from "./env-config.ts";
import type { ComposeContext, ComposeServiceStatus } from "./docker-compose.ts";

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
  openService: "web",
  openPort: 3000,
};

function makeDeps(overrides: Partial<SessionEnvDeps> = {}): SessionEnvDeps {
  return {
    loadEnvConfig: async () => AVAILABLE_CONFIG,
    runScript: async () => ({ stdout: "", stderr: "" }),
    composeUp: async () => {},
    composeDown: async () => {},
    composePs: async () => [],
    composePort: async () => null,
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

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);

  assert.equal(status.phase, "unavailable");
});

test("getSessionEnvStatus returns 'idle' when no containers are up", async () => {
  const deps = makeDeps({ composePs: async () => [] });
  const store = createSessionEnvStore();

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

  const stopPromise = stopSessionEnv(PROJECT, "feature-x", deps, store);
  await composeDownStarted;

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);
  assert.equal(status.phase, "stopping");

  await stopPromise;
});

test("getSessionEnvStatus derives 'running' + openUrl live from docker, without needing a prior start()", async () => {
  const services: ComposeServiceStatus[] = [{ service: "web", state: "running" }];
  const deps = makeDeps({
    composePs: async () => services,
    composePort: async (_ctx, service, port) => (service === "web" && port === 3000 ? 54321 : null),
  });
  const store = createSessionEnvStore();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);

  assert.equal(status.phase, "running");
  assert.equal(status.openUrl, "http://localhost:54321");
  assert.deepEqual(status.services, services);
});

test("getSessionEnvStatus builds openUrl from the given requestHost instead of hardcoded localhost", async () => {
  const services: ComposeServiceStatus[] = [{ service: "web", state: "running" }];
  const deps = makeDeps({
    composePs: async () => services,
    composePort: async (_ctx, service, port) => (service === "web" && port === 3000 ? 54321 : null),
  });
  const store = createSessionEnvStore();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store, "10.8.0.2");

  assert.equal(status.openUrl, "http://10.8.0.2:54321");
});

test("getSessionEnvStatus falls back to deps.openHost, then localhost, when no requestHost is given", async () => {
  const services: ComposeServiceStatus[] = [{ service: "web", state: "running" }];
  const deps = makeDeps({
    composePs: async () => services,
    composePort: async () => 54321,
    openHost: "192.168.1.50",
  });
  const store = createSessionEnvStore();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);

  assert.equal(status.openUrl, "http://192.168.1.50:54321");
});

test("startSessionEnv throws EnvUnavailableError when the project hasn't opted in", async () => {
  const deps = makeDeps({ loadEnvConfig: async () => null });
  const store = createSessionEnvStore();

  await assert.rejects(() => startSessionEnv(PROJECT, "feature-x", deps, store), EnvUnavailableError);
});

test("startSessionEnv throws EnvAlreadyRunningError when containers are already up", async () => {
  const deps = makeDeps({ composePs: async () => [{ service: "web", state: "running" }] });
  const store = createSessionEnvStore();

  await assert.rejects(() => startSessionEnv(PROJECT, "feature-x", deps, store), EnvAlreadyRunningError);
});

test("startSessionEnv throws EnvAlreadyRunningError when already starting", async () => {
  const deps = makeDeps({ composeUp: () => new Promise(() => {}) }); // never resolves during this test
  const store = createSessionEnvStore();

  await startSessionEnv(PROJECT, "feature-x", deps, store);
  assert.equal(store.get(FULL_NAME)?.phase, "starting");

  await assert.rejects(() => startSessionEnv(PROJECT, "feature-x", deps, store), EnvAlreadyRunningError);
});

test("startSessionEnv rejects a second truly concurrent start() for the same session (no TOCTOU race)", async () => {
  let composeUpCalls = 0;
  const deps = makeDeps({
    composeUp: async () => {
      composeUpCalls++;
    },
  });
  const store = createSessionEnvStore();

  // Both calls fire before either has a chance to claim the store entry --
  // this is what a security review flagged as a TOCTOU gap between the
  // "already starting" check and the store.set() that used to happen only
  // after an intervening `await safeComposePs(...)`.
  const results = await Promise.allSettled([
    startSessionEnv(PROJECT, "feature-x", deps, store),
    startSessionEnv(PROJECT, "feature-x", deps, store),
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

  await startSessionEnv(PROJECT, "feature-x", deps, store);
  await flush();

  assert.deepEqual(calls, [`run:${config.preRunScript}`, "up", `run:${config.postRunScript}`]);
  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);
  assert.equal(status.phase, "running");
  assert.equal(status.openUrl, "http://localhost:54321");
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

  await startSessionEnv(PROJECT, "feature-x", deps, store);
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

  await startSessionEnv(PROJECT, "feature-x", deps, store);
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

  await startSessionEnv(PROJECT, "feature-x", deps, store);
  await flush();

  const status = await getSessionEnvStatus(PROJECT, "feature-x", deps, store);
  assert.equal(status.phase, "error");
  assert.match(status.message ?? "", /migration failed/);
  assert.deepEqual(status.services, [{ service: "web", state: "running" }]);
  assert.equal(status.openUrl, "http://localhost:54321");
});

test("stopSessionEnv throws EnvNotRunningError when nothing is running", async () => {
  const deps = makeDeps({ composePs: async () => [] });
  const store = createSessionEnvStore();

  await assert.rejects(() => stopSessionEnv(PROJECT, "feature-x", deps, store), EnvNotRunningError);
});

test("stopSessionEnv throws EnvUnavailableError when the project hasn't opted in", async () => {
  const deps = makeDeps({ loadEnvConfig: async () => null });
  const store = createSessionEnvStore();

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

  await stopSessionEnv(PROJECT, "feature-x", deps, store);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].projectName, FULL_NAME);
  assert.equal(store.get(FULL_NAME), undefined);
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
